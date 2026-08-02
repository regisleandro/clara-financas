# Clara Finanças

A Clara é uma aplicação de finanças pessoais orientada por conversa. A pessoa envia uma fatura, conversa com a Clara sobre o próprio dinheiro e recebe explicações rastreáveis até as transações que originaram cada valor.

O projeto é um monorepo TypeScript gerenciado por pnpm e Turborepo. Ele possui duas superfícies de runtime:

- **Control plane (`apps/web`)**: aplicação Next.js que cuida da interface, autenticação, tenants, upload de documentos e APIs auxiliares.
- **Agent plane (`packages/agent`)**: agente Eve executado separadamente. O navegador se conecta a ele diretamente, usando um JWT curto emitido pelo control plane.

Documentação complementar:

- [Deploy na Vercel](docs/deploy.md) — os dois projetos, variáveis por plano e armadilhas
- [Diagrama navegável da arquitetura](docs/arquitetura-clara.html)

## Arquitetura

```text
Navegador
  ├── HTTPS → Next.js / Control plane
  │             ├── Better Auth (sessão)
  │             ├── /api/token (JWT para o agente)
  │             ├── /api/documents/prepare (hash, deduplicação, modo)
  │             ├── /api/documents/upload (token de escrita no Blob)
  │             ├── /api/documents (registro e idempotência)
  │             └── Server Components → PostgreSQL
  │
  ├── HTTPS → Vercel Blob (PDF direto, sem passar pela função)
  │
  └── HTTPS + Bearer JWT → Eve / Agent plane
                           ├── Coordenadora Clara (gerente de conta)
                           ├── Extrator de PDFs (escrituração)
                           ├── Analista do razão (análise)
                           ├── Categorizador (guarda-livros)
                           └── Tools + HITL + schedules

PostgreSQL ← Drizzle, RLS e escopo transacional por tenant
Blob/filesystem ← PDFs; o banco guarda somente chave e hash
OpenAI/AI Gateway ← inferência; cálculos financeiros são determinísticos
```

O fluxo financeiro principal é:

```text
upload PDF → extração → lote proposto → checksum/conferência
           → aprovação explícita da pessoa → transações confirmadas no razão
```

### O PDF não atravessa a API

O arquivo vai do navegador **direto** para o armazenamento; a função só recebe
um registro com o URL, o caminho e o hash. Três motivos, em ordem de peso:

1. **O teto de 4,5 MB some.** Uma Vercel Function recusa corpos acima disso
   antes de qualquer código rodar. O limite de 20 MB que o app anunciava era,
   em produção, um 413 da plataforma sem mensagem para a pessoa.
2. **O arquivo trafega uma vez, não duas.** Antes era navegador → função →
   Blob, com a fatura inteira bufferizada na memória da função no meio.
3. **O erro chega antes do upload.** O parser roda no navegador
   (`lib/pdf-precheck.ts`): abre o PDF, confere que existe camada de texto e
   descarta o que leu. Um escaneado é recusado na hora, em vez de subir, virar
   linha no banco, virar mensagem no chat e só então falhar no extrator.

O passo `prepare` calcula o caminho a partir do tenant da sessão e do SHA-256
que o navegador computou — e, quando aquele conteúdo já é um documento do
tenant, responde `reused` e **nada sobe**. O token de escrita é emitido para
aquele caminho, com `application/pdf` e teto de tamanho; o registro re-deriva o
caminho e confere o blob com um `head` autenticado antes de gravar a linha.

Quem extrai o texto continua sendo o agente, lendo o PDF do armazenamento
(`read_pdf_pages`). Nenhum texto extraído é transmitido nem armazenado.

Sem `BLOB_READ_WRITE_TOKEN` — o desenvolvimento local — `prepare` responde
`proxy` e o arquivo volta a passar pela função, para o disco.

Um lote `proposed` não é considerado gasto confirmado. A tool `commit_batch` é o único caminho de escrita no razão e exige aprovação humana. Consultas e agregações usam `packages/ledger`, que preserva a proveniência através dos `transactionIds`.

### O estado do razão entra no contexto a cada turno

A Clara não descobre o que existe perguntando. Antes de cada turno, instruções dinâmicas do eve (`packages/agent/agent/instructions/estado.ts`) leem `loadSnapshot()` e injetam no contexto: a data de hoje em São Paulo, as faturas registradas com ciclo, vencimento, total e resultado da conferência, a cobertura do razão e quantos lançamentos seguem sem categoria.

Resolve em `turn.started`, não em `session.started`: dentro da mesma conversa a pessoa aprova uma fatura, e o turno seguinte precisa enxergar o razão já atualizado.

O eve rebaixa instruções dinâmicas a mensagens de sistema guardadas por slug, e o valor do turno substitui o do turno anterior — existe sempre um snapshot só no request, e ele não entra no histórico da conversa. O que ele não pode ser é uma segunda fonte de verdade sobre algo que muda no meio do turno: `read_batch` e `resolve_invoice_reference` reescrevem o foco da sessão depois que o bloco já foi lido. Por isso o campo se chama `activeInvoiceAtTurnStart` e o bloco declara a precedência — resultado de ferramenta do turno vence o snapshot —, e por isso ele avisa que ali só há id de fatura e de documento: um `transactionId` existe apenas no retorno de `read_batch`.

O analista e o categorizador têm cada um o seu próprio — um subagente declarado não herda nada do root, e essa duplicação é o preço do isolamento que garante que o extrator não alcance o razão.

O snapshot é deliberadamente limitado às 12 faturas mais recentes. Quando a
pessoa menciona uma fatura mais antiga, a Clara usa `list_invoices` para
recuperar o histórico sob demanda. Assim o custo de contexto não cresce sem
limite junto com a vida financeira da pessoa.

### A conversa traduz a execução

Extrator, analista e categorizador devolvem contratos estruturados validados
por Zod. A coordenadora escolhe a apresentação, mas não precisa copiar números
ou ids de uma resposta livre. Painéis financeiros falham fechado quando falta
proveniência.

Na interface, nomes de tools, raciocínio e JSON não aparecem. O stream vira
progresso orientado à tarefa — “Lendo o documento”, “Conferindo os valores” —
e cada escrita durável tem um cartão próprio com objeto, alcance e
consequência. Chamar a tool abre a decisão; não existe um “sim” em prosa
seguido de uma segunda confirmação.

Upload também não fabrica uma mensagem com `documentId`: o texto visível é
natural e o identificador viaja em `clientContext` de um turno. Senhas de PDF
usam resposta livre protegida e são removidas do histórico guardado neste
dispositivo.

### Fatura não é intervalo de datas

Um ciclo que fecha em 07/07 cobre compras de 31/05 a 30/06, e duas faturas consecutivas se tocam na virada. Por isso as ferramentas do analista aceitam `batchId`: recortar por data conta a compra da fronteira dos dois lados. O snapshot entrega os `batchId` disponíveis, então "nesta fatura" tem resposta exata.

### Identidade do comerciante

O emissor imprime o mesmo comerciante de formas diferentes a cada fatura — máscara do cartão, câmbio na descrição, número da parcela, prefixo do intermediário, invólucro do `IOF de "…"`. `merchantKey()` em `packages/ledger/src/merchant.ts` deriva uma identidade determinística, gravada em `transactions.merchant_key` no momento da proposta.

Ela resolve a parte mecânica e **deliberadamente não adivinha** que "Anthropic" e "Claude.Ai Subscription" são a mesma empresa: fusão errada some com dinheiro de um comerciante e o faz aparecer em outro, sem sinal na tela. Esse caso é aprendizado com aprovação — um conceito `MerchantAlias`, consumido por `detectRecurrences`.

### O razão por operadora e por mês

`/transacoes?vista=operadoras` cruza o gasto confirmado: operadora nas linhas, mês nas colunas, com as duas margens fechando no mesmo total. A operadora é `documents.issuer` — ela é do DOCUMENTO, não da linha, porque é a mesma informação para toda a fatura e duplicá-la abriria a chance de uma linha discordar da fatura de onde veio. O mês é o da **compra**, não o do fechamento: uma fatura fechada em julho cobre gastos de maio e junho.

A agregação é `aggregateByIssuerMonth()` em `packages/ledger/src/analysis.ts` — pura, testada e usada pelos dois lados, pelo mesmo motivo das demais: dois caminhos de cálculo acabariam divergindo entre a tela e a conversa. Cada célula carrega os `transactionIds` que a compõem, e é deles que a lista "de onde vem cada número" é montada, em vez de um segundo filtro parecido.

Na conversa, quem a alcança é `aggregate_by_month`, do analista: uma chamada devolve a série inteira, cada mês com proveniência e com a composição por operadora. Antes dela só a tela chegava a esta conta, e "quanto gastei mês a mês" exigia uma chamada por mês, adivinhando quantos meses existem — a mesma falha da fila de revisão atrás de `server-only`: a resposta existia na aba ao lado e a conversa dizia que não sabia.

Documento sem operadora identificada não some da matriz: vira a linha "Sem operadora", e a tela de revisão oferece nomeá-lo.

### Revisão manual: o que a IA não fechou

`/revisar` é a fila do trabalho que a extração não concluiu. Entram lançamentos **sem categoria** (a análise por categoria fica com um buraco), de **confiança baixa** (o extrator avisou que pode ter lido errado, e o valor conta como gasto de qualquer forma) e **sem comerciante** (a linha não se agrupa com nada). Fatura cuja soma não fechou e documento sem operadora aparecem em listas próprias — são o documento inteiro, não a linha.

"Sem categoria" quer dizer **gasto** sem categoria: pagamento de fatura e ajuste de saldo não esperam categoria nenhuma, e ficam fora do motivo (podem entrar pelos outros dois). O predicado é um só — `uncategorizedSpendCondition()` em `packages/db/src/queries/review.ts` —, compartilhado pela fila, pelo estado do razão que a Clara lê a cada turno e pela triagem do guarda-livros. Quando divergiam, a conversa afirmava "há 2 itens sem categoria" e, na frase seguinte, não conseguia listá-los: a fila devolvia outra contagem, e o item já atestado não aparecia em nenhuma das duas.

A tela mostra a **descrição crua do documento**: é contra ela que a pessoa confere, e escondê-la transformaria a revisão em adivinhação sobre o palpite da Clara.

As escritas seguem a mesma disciplina da tool `recategorize_transactions` — o caminho humano não é um atalho que escapa da auditoria. Categoria e comerciante são leitura e podem mudar, cada mudança gravando uma linha em `transaction_reclassifications` com autor `human:<id>`. Valor, data, descrição e origem seguem recusados pelo trigger; correção de valor continua sendo linha de ajuste, feita pela conversa.

O que é novo é o **atestado** (`transactions.reviewed_at` / `reviewed_by`, migração 0015): registra que uma pessoa olhou, mesmo quando nada muda. Sem ele a fila devolveria para sempre os itens cuja conclusão foi "a leitura já estava certa" — que é a conclusão mais comum — e a pessoa aprenderia a ignorá-la.

### Isolamento por tenant

O tenant é derivado da sessão autenticada; ele nunca é aceito do input do modelo ou do corpo enviado pelo cliente. O JWT contém `tenantId` e `userId`, é validado pelo canal Eve e, em cada tool, passa por `requireTenantCaller`. A função `forTenant()` define `app.tenant_id` localmente na transação para que as políticas RLS do PostgreSQL filtrem os dados na própria query.

## Estrutura do repositório

```text
clara-financas/
├── apps/
│   └── web/                 # Next.js 16, páginas, componentes e APIs
├── packages/
│   ├── agent/               # Eve, coordenadora, subagentes, tools e schedules
│   ├── auth/                # Better Auth + adapter Drizzle
│   ├── config/              # Configuração TypeScript compartilhada
│   ├── db/                  # Drizzle, schemas, migrações, RLS e tenant scope
│   ├── env/                 # Validação de variáveis de ambiente com Zod
│   ├── ledger/              # Regras, checksum e análises puras do razão
│   ├── okf/                 # Parser/validador dos bundles de conhecimento
│   ├── ui/                  # Primitivos visuais compartilhados
│   └── views/               # Contratos dos painéis e eventos HITL
├── bundles/constitution/    # Categorias, convenções e regras financeiras
├── docs/                    # Deploy e diagrama de arquitetura
├── PRODUCT.md               # Usuários, propósito e princípios estratégicos
├── DESIGN.md / DESIGN.json  # Sistema visual e tokens para agentes de interface
├── scripts/                 # Env da Vercel e reset do razão
├── turbo.json               # Pipeline do Turborepo
└── pnpm-workspace.yaml      # Workspace e catálogo de dependências
```

### Pacotes de domínio

- `@clara-financas/ledger` contém funções puras para total, categorias, comparação de períodos, recorrências, identidade de comerciante e checksum. Nenhuma delas chama um modelo.
- `@clara-financas/views` define, com Zod, os formatos de painel (`metric`, `breakdown`, `comparison`, `recurrences`, `transactions`, `invoices`, `commitments`, `proposal` e `checksum`) e a leitura de pedidos de aprovação.

  Toda linha com valor exige `transactionIds`, e as três exceções são as mesmas três coisas: `commitments` (um lembrete não saiu de lançamento nenhum), `checksum` e `invoices` (o total de uma fatura é o que o documento declara, não uma soma escolhida). A exceção não é indulgência — sem ela, a forma certa fica inexprimível e o sintoma é a pessoa pedir uma lista e não receber painel nenhum. Foi assim com a conferência, e depois com "liste as faturas mês a mês".
- `@clara-financas/okf` carrega e valida conceitos Markdown/YAML. A constituição define o contrato do domínio; aprendizados são separados e reversíveis.

## Pré-requisitos

- Node.js 24.x
- pnpm 10.x
- PostgreSQL acessível pela aplicação
- credenciais do Better Auth e, se usado, Google OAuth
- chave da API do modelo ou configuração do AI Gateway

Instale as dependências com:

```bash
pnpm install
```

As variáveis do control plane são validadas em `packages/env/src/server.ts`; as variáveis públicas do navegador ficam em `packages/env/src/web.ts`. Em desenvolvimento, o arquivo de ambiente normalmente usado pelo app é `apps/web/.env`.

Variáveis essenciais incluem `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `APP_ORIGIN`, `AGENT_TOKEN_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `NEXT_PUBLIC_AGENT_HOST`. Para migrações e para o `db:reset`, também `DATABASE_ADMIN_URL`. O agente tem o seu próprio `packages/agent/.env`, com as variáveis de modelo e, no modo silo, `TENANT_ID`.

Em produção, `BLOB_READ_WRITE_TOKEN` é obrigatório: o armazenamento local de PDFs só existe em desenvolvimento. A tabela completa por projeto está em [docs/deploy.md](docs/deploy.md).

## Desenvolvimento

Suba o web app e o agente em terminais separados:

```bash
pnpm dev:web
pnpm dev:agent
```

Ou execute todos os pacotes que possuem uma tarefa `dev`:

```bash
pnpm dev
```

Por padrão, o web app usa a porta `3000`. O agente Eve usa a porta definida pelo próprio ambiente de desenvolvimento.

### Banco de dados

```bash
pnpm db:generate   # gera uma migração a partir do schema
pnpm db:migrate    # aplica migrações existentes
pnpm db:push       # sincroniza o schema diretamente (desenvolvimento)
pnpm db:studio     # abre o Drizzle Studio
pnpm db:reset      # zera o razão para recomeçar os testes
```

O banco atual é PostgreSQL. Os PDFs não são armazenados como bytes no banco: em produção o navegador os envia direto ao Vercel Blob e o banco guarda apenas chave e hash; localmente, quando `BLOB_READ_WRITE_TOKEN` não está definido, são gravados em `.data/documents` pela função.

Dois papéis de banco, e a distinção é de segurança:

- `DATABASE_URL` — papel de **aplicação** (`clara_app`), sem superusuário e sem `BYPASSRLS`. É o que o app e o agente usam. Conectar como `postgres` faria a RLS virar enfeite.
- `DATABASE_ADMIN_URL` — papel de **migração**, dono do schema. Usado pelo `drizzle-kit` e pelo `db:reset`. Nunca é enviado para a Vercel.

### `pnpm db:reset`

Apaga documentos, faturas, transações, reclassificações, compromissos, notificações e os aprendizados. Preserva usuários, sessões de login, tenants e a constituição. Pede confirmação; `--yes` pula.

Usa `TRUNCATE` como dono do schema porque o trigger `clara_transactions_immutable` recusa apagar transação confirmada — afrouxar o trigger para limpar seria trocar a garantia pela conveniência.

## Testes e verificações

```bash
./scripts/dev-db.sh    # PostgreSQL local, os dois papéis e as migrações
pnpm check-types
pnpm test
pnpm test:isolation
```

O primeiro comando é pré-requisito dos outros dois, e não por conveniência:
`forTenant` recusa conectar como superusuário (a RLS viraria enfeite), então
testar exige um papel de aplicação de verdade, separado do dono do schema. O
script cria os dois, sobe o cluster, aplica as migrações e escreve as URLs em
`apps/web/.env` e `packages/agent/.env` sem sobrescrever o que já estiver lá.
`--reset` recomeça do zero.

As senhas são **geradas** na primeira execução e vivem só no `.env`, que é
ignorado pelo git — nenhuma literal no script, nem de brincadeira. Execuções
seguintes reaproveitam a que já está lá, para o banco e o arquivo não
divergirem. Como o papel nasce antes da migração, a senha fraca de bootstrap
que a migração `0001` define não chega a ser usada: é o mesmo caminho que
[docs/deploy.md](docs/deploy.md) manda seguir em produção.

Os testes de `packages/agent/tests/tools/` exercitam cada ferramenta do agente
contra esse banco — propor uma fatura, conferir, corrigir a natureza de um
lançamento, registrar, ajustar, recategorizar, revisar, descartar — e as
asserções olham o estado do banco, não o texto da resposta. Nenhum modelo
participa: uma tool é uma função, e é assim que ela é testada.

O Turborepo usa o grafo de dependências declarado nos `package.json` para ordenar builds e verificações. Para trabalhar apenas no app web e suas dependências, use filtros:

```bash
pnpm exec turbo run build --filter=web...
pnpm exec turbo run check-types --filter=web...
```

Para mudanças incrementais em CI, o modo recomendado é:

```bash
pnpm exec turbo run build --affected
```

## Comandos disponíveis na raiz

| Comando | Função |
| --- | --- |
| `pnpm dev` | Executa as tarefas de desenvolvimento via Turborepo |
| `pnpm dev:web` | Inicia somente o Next.js |
| `pnpm dev:agent` | Inicia somente o agente Eve |
| `pnpm build` | Compila os pacotes e a aplicação |
| `pnpm check-types` | Verifica os tipos em todo o workspace |
| `pnpm test` | Executa os testes dos pacotes |
| `pnpm test:isolation` | Executa os testes de isolamento do banco |
| `pnpm db:generate` | Gera migrações Drizzle |
| `pnpm db:migrate` | Aplica migrações |
| `pnpm db:push` | Faz push do schema em desenvolvimento |
| `pnpm db:studio` | Abre o Drizzle Studio |
| `pnpm db:reset` | Zera o razão preservando login e constituição |
| `pnpm deploy:setup` | Vincula a raiz ao projeto Vercel do control plane |
| `pnpm agent:link` | Vincula `packages/agent` ao projeto do agente |
| `pnpm env:production` | Envia as variáveis do control plane (`--plan` só mostra) |
| `pnpm env:agent:production` | Envia as variáveis do agente |
| `pnpm deploy` | Deploy de preview do control plane |
| `pnpm deploy:prod` | Deploy de produção do control plane |
| `pnpm deploy:agent` | Deploy do agente (`eve deploy`) |
| `pnpm deploy:check` | Dry-run de deploy Vercel |

## Implantação

No ar:

```
control plane  https://clara-financas-six.vercel.app
agente         https://clara-financas-agent.vercel.app
```

São **dois projetos Vercel**: o control plane (Next.js, na raiz) e a instância do agente (eve, em `packages/agent`). O navegador fala com o agente cross-origin, autenticado por um JWT curto emitido pelo control plane, e os dois compartilham `AGENT_TOKEN_SECRET` no modo pool atual.

O passo a passo, a dependência circular entre `APP_ORIGIN` e `NEXT_PUBLIC_AGENT_HOST`, a tabela de variáveis por projeto e as armadilhas conhecidas estão em **[docs/deploy.md](docs/deploy.md)**.

Não coloque arquivos `.env` ou segredos no repositório. O envio de variáveis é por allowlist, declarada por plano em `scripts/sync-vercel-env.ts`: uma variável fora dela não sobe — o que inclui, por construção, o papel de migração do banco.

## Decisões importantes

- **Modelo não é fonte de verdade financeira:** o modelo interpreta e escolhe tools; somas e comparações são funções determinísticas.
- **Aprovação é um gate real:** o estado durável do Eve pode esperar dias por uma decisão sem manter compute ativo.
- **Proveniência é obrigatória:** toda métrica exibida pode apontar para as transações que a compõem.
- **Contexto não se pede, se injeta:** o estado do razão entra por instruções dinâmicas antes do primeiro token, em vez de depender de o modelo lembrar de consultar.
- **Constituição versionada:** categorias e convenções são copiadas para o tenant e atualizadas quando a versão do bundle muda.
- **Aprendizado que não se aplica é anotação:** todo conceito gravado tem um consumidor — `CategorizationRule` em `apply_learned_rules`, `MerchantAlias` em `detectRecurrences`.

### Idempotência: o que está coberto e o que não está

Coberto, **por documento**: o SHA-256 do PDF com índice único `(tenant_id, content_hash)` impede o mesmo arquivo entrar duas vezes; `propose_batch` apaga rascunho anterior do mesmo documento e recusa propor um documento já registrado.

**Não coberto, por transação.** Não existe comparação de lançamentos entre lotes. O caso concreto: enviar a fatura ainda aberta, aprovar, e depois enviar a fatura fechada do mesmo ciclo. São arquivos diferentes, hashes diferentes, documentos diferentes — nada barra, e as compras que aparecem nas duas entram duas vezes no razão.

O que torna isso perigoso é que **as duas conferências passam**: o checksum prova fidelidade *documento → extração*, não consistência *extração → razão*. Cada fatura bate com o próprio total declarado e o cartão fica verde nas duas.

Enquanto não houver detecção por impressão digital do lançamento e supersessão de lote, a orientação é **não aprovar fatura parcial** — deixá-la como rascunho, que o snapshot mostra e permite retomar.
