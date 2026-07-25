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
  │             ├── /api/documents (upload e idempotência)
  │             └── Server Components → PostgreSQL
  │
  └── HTTPS + Bearer JWT → Eve / Agent plane
                           ├── Coordenadora Clara
                           ├── Extrator de PDFs
                           ├── Analista do razão
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

Um lote `proposed` não é considerado gasto confirmado. A tool `commit_batch` é o único caminho de escrita no razão e exige aprovação humana. Consultas e agregações usam `packages/ledger`, que preserva a proveniência através dos `transactionIds`.

### O estado do razão entra no contexto a cada turno

A Clara não descobre o que existe perguntando. Antes de cada turno, instruções dinâmicas do eve (`packages/agent/agent/instructions/estado.ts`) leem `loadSnapshot()` e injetam no contexto: a data de hoje em São Paulo, as faturas registradas com ciclo, vencimento, total e resultado da conferência, a cobertura do razão e quantos lançamentos seguem sem categoria.

Resolve em `turn.started`, não em `session.started`: dentro da mesma conversa a pessoa aprova uma fatura, e o turno seguinte precisa enxergar o razão já atualizado.

O analista tem o seu próprio — um subagente declarado não herda nada do root, e essa duplicação é o preço do isolamento que garante que o extrator não alcance o razão.

### Fatura não é intervalo de datas

Um ciclo que fecha em 07/07 cobre compras de 31/05 a 30/06, e duas faturas consecutivas se tocam na virada. Por isso as ferramentas do analista aceitam `batchId`: recortar por data conta a compra da fronteira dos dois lados. O snapshot entrega os `batchId` disponíveis, então "nesta fatura" tem resposta exata.

### Identidade do comerciante

O emissor imprime o mesmo comerciante de formas diferentes a cada fatura — máscara do cartão, câmbio na descrição, número da parcela, prefixo do intermediário, invólucro do `IOF de "…"`. `merchantKey()` em `packages/ledger/src/merchant.ts` deriva uma identidade determinística, gravada em `transactions.merchant_key` no momento da proposta.

Ela resolve a parte mecânica e **deliberadamente não adivinha** que "Anthropic" e "Claude.Ai Subscription" são a mesma empresa: fusão errada some com dinheiro de um comerciante e o faz aparecer em outro, sem sinal na tela. Esse caso é aprendizado com aprovação — um conceito `MerchantAlias`, consumido por `detectRecurrences`.

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
├── scripts/                 # Env da Vercel e reset do razão
├── turbo.json               # Pipeline do Turborepo
└── pnpm-workspace.yaml      # Workspace e catálogo de dependências
```

### Pacotes de domínio

- `@clara-financas/ledger` contém funções puras para total, categorias, comparação de períodos, recorrências, identidade de comerciante e checksum. Nenhuma delas chama um modelo.
- `@clara-financas/views` define, com Zod, os formatos de painel (`metric`, `breakdown`, `comparison`, `recurrences`, `transactions` e `checksum`) e a leitura de pedidos de aprovação.
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

O banco atual é PostgreSQL. Os PDFs não são armazenados como bytes no banco: em produção são enviados ao Vercel Blob; localmente, quando `BLOB_READ_WRITE_TOKEN` não está definido, são gravados em `.data/documents`.

Dois papéis de banco, e a distinção é de segurança:

- `DATABASE_URL` — papel de **aplicação** (`clara_app`), sem superusuário e sem `BYPASSRLS`. É o que o app e o agente usam. Conectar como `postgres` faria a RLS virar enfeite.
- `DATABASE_ADMIN_URL` — papel de **migração**, dono do schema. Usado pelo `drizzle-kit` e pelo `db:reset`. Nunca é enviado para a Vercel.

### `pnpm db:reset`

Apaga documentos, faturas, transações, reclassificações, compromissos, notificações e os aprendizados. Preserva usuários, sessões de login, tenants e a constituição. Pede confirmação; `--yes` pula.

Usa `TRUNCATE` como dono do schema porque o trigger `clara_transactions_immutable` recusa apagar transação confirmada — afrouxar o trigger para limpar seria trocar a garantia pela conveniência.

## Testes e verificações

```bash
pnpm check-types
pnpm test
pnpm test:isolation
```

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
