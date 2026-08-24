# Clara Finanças

A Clara é uma aplicação de finanças pessoais orientada por conversa. A pessoa envia uma fatura, conversa com a Clara sobre o próprio dinheiro e recebe explicações rastreáveis até as transações que originaram cada valor.

O projeto é um monorepo poliglota — TypeScript e Python — com duas superfícies de runtime, cada uma um **serviço separado**:

- **Control plane (`apps/web`)**: aplicação Next.js que cuida da interface, autenticação, tenants, upload de documentos e APIs auxiliares. TypeScript.
- **Agent plane (`services/agent`)**: serviço Python sobre o framework Agno, dono do razão inteiro — schema, migrações, regras e agregações — e da conversa. O navegador fala com ele diretamente e cross-origin, usando um JWT curto emitido pelo control plane.

Por que dois serviços em duas linguagens: Agno não tem SDK TypeScript, e login (Better Auth) não tem equivalente pronto em Python — cada serviço ficou na linguagem onde a peça que ele precisa já existe. O porquê de cada decisão da reescrita, e o que ficou deliberadamente para trás, está em [`docs/ledger-python.md`](docs/ledger-python.md); leia-o antes de portar mais alguma coisa do agente antigo.

Documentação complementar:

- [O razão em Python](docs/ledger-python.md) — as decisões da reescrita, o que foi reduzido de propósito e o que ficou faltando
- [Deploy](docs/deploy.md) — os dois serviços, variáveis por plano e armadilhas
- [Diagrama navegável da arquitetura](docs/arquitetura-clara.html) *(descreve a arquitetura anterior — ver nota no próprio arquivo)*

## Arquitetura

```text
Navegador
  ├── HTTPS → Next.js / Control plane (apps/web, TypeScript)
  │             ├── Better Auth (sessão)
  │             ├── /api/token (JWT para o agente)
  │             ├── /api/documents/prepare (hash, deduplicação, modo)
  │             ├── /api/documents/upload (token de escrita no Blob)
  │             ├── /api/documents (registro e idempotência)
  │             └── Server Components → PostgreSQL
  │
  ├── HTTPS → Vercel Blob (PDF direto, sem passar pela função)
  │
  └── HTTPS + Bearer JWT → services/agent (Python, Agno + AgentOS)
                           ├── POST /agui — a conversa (protocolo AG-UI)
                           ├── GET /api/ledger/* — leitura para as telas
                           ├── Coordenadora Clara (Team do Agno)
                           │     └── Extrator de PDFs (Agent isolado, delegado)
                           └── ~34 tools de domínio + o Schedule diário de vencimentos

PostgreSQL ← SQLAlchemy + Alembic, RLS e escopo transacional por tenant
Blob/filesystem ← PDFs; o banco guarda somente chave e hash
OpenAI ← inferência; cálculos financeiros são determinísticos, em Python puro
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
   antes de qualquer código rodar.
2. **O arquivo trafega uma vez, não duas.** Navegador → Blob direto, sem a
   fatura inteira bufferizada na memória de uma função no meio.
3. **O erro chega antes do upload.** O parser roda no navegador
   (`lib/pdf-precheck.ts`): abre o PDF, confere que existe camada de texto e
   descarta o que leu. Um escaneado é recusado na hora, em vez de subir, virar
   linha no banco, virar mensagem no chat e só então falhar no extrator.

O passo `prepare` calcula o caminho a partir do tenant da sessão e do SHA-256
que o navegador computou — e, quando aquele conteúdo já é um documento do
tenant, responde `reused` e **nada sobe**.

Quem extrai o texto é o agente Python, lendo o PDF do armazenamento
(`clara/tools/read_pdf_pages.py`). Nenhum texto extraído é transmitido nem
armazenado. PDF protegido por senha: a senha chega como argumento comum da
tool, em texto simples — não há um segundo campo protegido nem uma segunda
pausa do turno para isso.

Sem `BLOB_READ_WRITE_TOKEN` — o desenvolvimento local — `prepare` responde
`proxy` e o arquivo volta a passar pela função, para o disco.

Um lote `proposed` não é considerado gasto confirmado. A tool `commit_batch` é o único caminho de escrita no razão e exige aprovação humana — o gate real do Agno, `requires_confirmation=True`, que pausa o turno de forma durável em vez de manter compute ativo esperando. Consultas e agregações são funções puras em `clara/ledger/` (Python), e as MESMAS funções servem a conversa e as telas.

### O estado do razão entra no contexto a cada turno

A Clara não descobre o que existe perguntando. `clara/instructions/dynamic.py` resolve, a cada `run` do Agno (o equivalente a `turn.started`, não `session.started`), `load_snapshot()` e injeta no contexto: a data de hoje em São Paulo, as faturas registradas com ciclo, vencimento, total e resultado da conferência, a cobertura do razão e quantos lançamentos seguem sem categoria.

Resolve a cada turno porque, dentro da mesma conversa, a pessoa aprova uma fatura e o turno seguinte precisa enxergar o razão já atualizado (FR-021). Falha fechada: sem tenant autenticado, só as instruções estáticas de `coordinator.md` são injetadas — um snapshot é dado financeiro de alguém, e degradar para "sem contexto" é a única queda aceitável.

O extrator tem o próprio isolamento: como `Agent` delegado dentro do `Team`, ele não herda o snapshot do razão nem a lista de categorias do tenant — por isso toda transação que ele propõe sai com `category: null`, e é assim de propósito (ver `docs/ledger-python.md`).

O snapshot é deliberadamente limitado às 12 faturas mais recentes. Quando a
pessoa menciona uma fatura mais antiga, a Clara usa `list_invoices` para
recuperar o histórico sob demanda.

### A conversa traduz a execução

Cada tool de painel já devolve o contrato estruturado validado (Pydantic) — não há uma etapa separada de "apresentação" entre calcular e mostrar (o original tinha `present_analysis`/`present_categorization`/`present_view`; este port não). A coordenadora escolhe como falar sobre o que voltou, mas não copia números ou ids de uma resposta livre. Painéis financeiros falham fechado quando falta proveniência — `require_provenance()` roda dentro de `to_tool_result()`, o ponto único pelo qual todo painel passa antes de alcançar o modelo (ver `docs/ledger-python.md`).

Na interface, nomes de tools, raciocínio e JSON não aparecem — o protocolo é AG-UI (`@ag-ui/client`, sem CopilotKit ou outro chat pronto que exiba isso por padrão). O stream vira progresso orientado à tarefa, e cada escrita durável tem um cartão próprio com objeto, alcance e consequência: a chamada da tool gated (`requires_confirmation=True`) abre a decisão; não existe um "sim" em prosa seguido de uma segunda confirmação.

### Fatura não é intervalo de datas

Um ciclo que fecha em 07/07 cobre compras de 31/05 a 30/06, e duas faturas consecutivas se tocam na virada. Por isso as ferramentas do analista aceitam recorte por `batch_id` (`clara/tools/analysis_scope.py`): recortar por data contaria a compra da fronteira dos dois lados. O snapshot entrega os `batch_id` disponíveis, então "nesta fatura" tem resposta exata.

### Identidade do comerciante

O emissor imprime o mesmo comerciante de formas diferentes a cada fatura — máscara do cartão, câmbio na descrição, número da parcela, prefixo do intermediário, invólucro do `IOF de "…"`. `merchant_key()` em `clara/ledger/merchant.py` deriva uma identidade determinística, gravada em `transactions.merchant_key` no momento da proposta.

Ela resolve a parte mecânica e **deliberadamente não adivinha** que "Anthropic" e "Claude.Ai Subscription" são a mesma empresa: fusão errada some com dinheiro de um comerciante e o faz aparecer em outro, sem sinal na tela. Esse caso é aprendizado com aprovação — um conceito `MerchantAlias`, gravado por `save_concept` e consumido por `detect_recurrences`.

### O razão por operadora e por mês

A tool `aggregate_by_month` cruza o gasto confirmado: uma chamada devolve a série inteira, cada mês com proveniência e, quando há mais de uma operadora, a composição por operadora dentro do mesmo mês. A operadora é `documents.issuer` — do DOCUMENTO, não da linha, porque é a mesma informação para toda a fatura. O mês é o da **compra**, não o do fechamento: uma fatura fechada em julho cobre gastos de maio e junho.

A agregação (`clara/ledger/analysis.py`, `aggregate_by_issuer_month`) é pura, testada, e é a MESMA função que a tela (`/inicio`, `/comparacao`, via `clara/api/router.py`) e a conversa chamam — dois caminhos de cálculo para o mesmo número são exatamente o defeito que este princípio evita (FR-017).

Documento sem operadora identificada não some da matriz: vira a linha "Sem operadora", e `name_issuer` permite corrigi-lo.

### Revisão manual: o que a IA não fechou

`list_review_queue` é a fila do trabalho que a extração não concluiu. Entram lançamentos **sem categoria** (a análise por categoria fica com um buraco), de **confiança baixa** (o extrator avisou que pode ter lido errado) e **sem comerciante** (a linha não se agrupa com nada).

"Sem categoria" quer dizer **gasto** sem categoria: pagamento de fatura e ajuste de saldo não esperam categoria nenhuma. O predicado é um só, compartilhado pela fila e pelo estado do razão que a Clara lê a cada turno (FR-020) — quando divergiam, a conversa afirmava "há 2 itens sem categoria" e a fila devolvia outra contagem.

As escritas seguem a mesma disciplina da tool `recategorize_transactions` — o caminho não escapa da auditoria. Categoria e comerciante podem mudar, cada mudança gravando uma linha em `transaction_reclassifications` com autor `human:<id>`. Valor, data, descrição e origem seguem recusados pelo trigger do banco (`clara_transactions_immutable`); correção de valor é sempre uma linha de ajuste (`create_adjustment`), nunca uma reescrita.

`mark_reviewed` registra o **atestado** (`transactions.reviewed_at`/`reviewed_by`): que uma pessoa olhou, mesmo quando nada muda. Sem ele a fila devolveria para sempre os itens cuja conclusão foi "a leitura já estava certa" — a conclusão mais comum.

### Aprendizado, compromissos e avisos

`save_concept` é o segundo gate: grava um aprendizado (regra de categorização, apelido de comerciante, categoria nova) só no bundle `learnings`, sempre com uma revisão em `concept_revisions` carimbada `human:<user_id>` (convenção de ator do OKF §7). `read_concept_history` lê o histórico; reverter é chamar `save_concept` de novo com o corpo antigo — uma revisão nova, nada apagado.

Compromissos (`save_commitment`) e a varredura diária de vencimentos (`clara/agents/reminders.py`, agendada via `AgentOS(scheduler=True)`) fecham o ciclo de proatividade: relevância (o vencimento está perto) e consentimento (`set_proactivity` desliga os avisos automáticos por inteiro; `deactivate_commitment` desliga um lembrete só).

### Isolamento por tenant

O tenant é derivado da sessão autenticada; ele nunca é aceito do input do modelo ou do corpo enviado pelo cliente. O JWT contém `tenantId` e `userId`, é validado pelo `AuthMiddleware` do Agno e, em cada tool, passa por `require_tenant_caller()`. A função `for_tenant()` define `app.tenant_id` localmente na transação para que as políticas RLS do PostgreSQL filtrem os dados na própria query — recusa conectar como superusuário, ou a RLS viraria enfeite.

## Estrutura do repositório

```text
clara-financas/
├── apps/
│   └── web/                 # Next.js 16, páginas, componentes e APIs (TypeScript)
├── services/
│   └── agent/                # Agno, FastAPI, AG-UI — o razão inteiro (Python)
│       ├── clara/
│       │   ├── os_app.py     # AgentOS: team, db, AGUI, JWT, scheduler
│       │   ├── agents/       # coordinator, extractor, reminders (o scheduler)
│       │   ├── instructions/ # coordinator.md, o snapshot dinâmico
│       │   ├── tools/        # uma ferramenta por arquivo, ~34 no total
│       │   ├── ledger/       # money, merchant, checksum, statement, analysis — puro
│       │   ├── db/           # models.py (SQLAlchemy), tenant_scope, queries
│       │   ├── views/        # contratos Pydantic dos painéis + a exigência de proveniência
│       │   └── api/          # rotas FastAPI de leitura para as telas
│       ├── migrations/       # Alembic — schema, RLS, triggers, papéis
│       ├── tests/            # pytest contra PostgreSQL real
│       ├── Dockerfile
│       └── docker-compose.yml
├── packages/
│   ├── auth/                # Better Auth + adapter Drizzle (control plane)
│   ├── config/               # Configuração TypeScript compartilhada
│   ├── db/                   # Drizzle — ainda serve telas não migradas (ver docs/ledger-python.md)
│   ├── env/                  # Validação de variáveis de ambiente com Zod
│   ├── ledger/                # Regras/análises antigas — idem
│   ├── okf/                   # Parser dos bundles — ainda usado por apps/web/lib/tenant.ts
│   ├── ui/                    # Primitivos visuais compartilhados
│   └── views/                 # Contratos de painel antigos — idem
├── bundles/constitution/     # Categorias, convenções e regras financeiras
├── docs/                     # Deploy, arquitetura e as decisões da reescrita
├── PRODUCT.md                # Usuários, propósito e princípios estratégicos
├── DESIGN.md / DESIGN.json   # Sistema visual e tokens para agentes de interface
├── scripts/                  # Env da Vercel e reset do razão
├── turbo.json                # Pipeline do Turborepo
└── pnpm-workspace.yaml       # Workspace e catálogo de dependências (TypeScript)
```

`packages/{db,ledger,views,ui,okf}` **ainda existem** porque `/transacoes`, `/revisar`, `/validacao`, `/agenda` e vários componentes de `apps/web` continuam lendo o razão pelo caminho Drizzle antigo — só `/inicio` e `/comparacao` foram movidas para a API Python. `packages/agent` (o agente Eve original) foi removido: zero referências restantes, confirmado antes de apagar. Detalhes de cada redução de escopo estão em [`docs/ledger-python.md`](docs/ledger-python.md).

## Pré-requisitos

- Node.js 24.x, pnpm 10.x — para `apps/web`
- Python 3.12+, [`uv`](https://docs.astral.sh/uv/) — para `services/agent`
- PostgreSQL acessível pelos dois serviços
- credenciais do Better Auth e, se usado, Google OAuth
- uma chave de API da OpenAI (`OPENAI_API_KEY`) para o agente responder de verdade

Instale as dependências:

```bash
pnpm install                       # apps/web e os pacotes TypeScript
cd services/agent && uv sync       # o agente Python
```

As variáveis do control plane são validadas em `packages/env/src/server.ts`; as públicas do navegador, em `packages/env/src/web.ts`. O agente Python valida as suas em `services/agent/clara/settings.py` (Pydantic). Em desenvolvimento, o arquivo normalmente usado por cada serviço é `apps/web/.env` e `services/agent/.env`.

Variáveis essenciais do control plane: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `APP_ORIGIN`, `AGENT_TOKEN_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXT_PUBLIC_AGENT_HOST`. Do agente: `DATABASE_URL`, `AGENT_TOKEN_SECRET` (**o mesmo valor** dos dois lados — é o segredo HS256 compartilhado), `APP_ORIGIN`, `OPENAI_API_KEY`, `CLARA_MODEL`/`CLARA_EXTRACTOR_MODEL` (default `gpt-5` nos dois).

Em produção, `BLOB_READ_WRITE_TOKEN` é obrigatório no control plane. A tabela completa está em [docs/deploy.md](docs/deploy.md).

## Desenvolvimento

Suba o banco primeiro (veja "Banco de dados" abaixo), depois os dois serviços em terminais separados:

```bash
pnpm dev:web                                                        # apps/web, porta 3000
cd services/agent && uv run uvicorn clara.os_app:app --reload --port 8000  # o agente
```

`NEXT_PUBLIC_AGENT_HOST` em `apps/web/.env` precisa apontar para onde o agente está escutando (`http://127.0.0.1:8000` em desenvolvimento local).

### Banco de dados

**`scripts/dev-db.sh` ainda não foi adaptado para o Alembic** (ver `docs/ledger-python.md`) — ele só migra o schema TypeScript antigo. O caminho manual para o banco do razão:

```bash
# 1. papéis + banco, como superusuário do Postgres
createuser clara_owner --createdb
createuser clara_app
createdb clara --owner=clara_owner
psql clara -c "CREATE EXTENSION IF NOT EXISTS unaccent; CREATE EXTENSION IF NOT EXISTS pg_trgm;"

# 2. migração — cria clara_app/clara_owner se ainda não existirem (IF NOT EXISTS),
#    aplica RLS, triggers e o schema do Agno
cd services/agent
DATABASE_ADMIN_URL='postgresql+psycopg://postgres@localhost/clara' \
DATABASE_URL='postgresql+psycopg://clara_app:<senha>@localhost/clara' \
uv run alembic upgrade head
```

`apps/web` ainda precisa de `session`, `account` e `verification` (Better Auth; `user` a migração Python já cria). **Não rode `pnpm db:migrate` depois do Alembic** — as duas migrações criam as MESMAS 19 tabelas do razão, e a segunda falha em "relation already exists" assim que alcança uma que a outra já criou (confirmado tentando, não suposto). Crie só as três que faltam:

```sql
-- contra o mesmo banco, como clara_owner (dono do schema)
CREATE TABLE session (
  id TEXT PRIMARY KEY, expires_at TIMESTAMPTZ NOT NULL, token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address TEXT, user_agent TEXT, user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);
CREATE TABLE account (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL, provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  access_token TEXT, refresh_token TEXT, id_token TEXT,
  access_token_expires_at TIMESTAMPTZ, refresh_token_expires_at TIMESTAMPTZ,
  scope TEXT, password TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE verification (
  id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON session, account, verification TO clara_app;
```

(O schema exato é `packages/db/src/schema/auth.ts`, a fonte da verdade — copie de lá se ele mudar.) Sem isso, `pnpm db:generate`/`db:studio` do Drizzle também não devem ser apontados para este banco: o journal do Drizzle não sabe que o Alembic já criou as tabelas do razão, e qualquer comando que tente aplicar a migração completa esbarra na mesma colisão. Ver `docs/ledger-python.md` para o que falta para as duas migrações conviverem de verdade (o mecanismo existe — `pnpm -F @clara-financas/db db:baseline` — mas não foi automatizado, porque decidir "qual migração venceu cada tabela" merece conferência humana).

Dois papéis de banco, e a distinção é de segurança:

- `DATABASE_URL` — papel de **aplicação** (`clara_app`), sem superusuário e sem `BYPASSRLS`. É o que os dois serviços usam para servir requisição.
- `DATABASE_ADMIN_URL` — papel de **migração** (`clara_owner` no lado Python; o equivalente Drizzle no lado TypeScript). Nunca é enviado para produção como `DATABASE_URL`.

## Testes e verificações

```bash
# TypeScript (apps/web e pacotes)
pnpm check-types
pnpm test
pnpm test:isolation

# Python (services/agent) — 253 testes, contra PostgreSQL real, sem mock
cd services/agent
uv run ruff check clara/ tests/
uv run mypy clara/
uv run pytest
```

Os testes de `services/agent/tests/` exercitam cada ferramenta do agente
contra um Postgres real — propor uma fatura, conferir, corrigir a natureza de um
lançamento, registrar, ajustar, recategorizar, revisar, aprender, agendar um
compromisso — e as asserções olham o estado do banco, não o texto de uma
resposta. Nenhum modelo participa: uma tool é uma função, e é assim que ela
é testada.

**Rodar a suíte não é o mesmo que provar que o serviço sobe.** Depois de testar, suba o processo de verdade e confira com `curl` — dois bugs reais (documentados em `docs/ledger-python.md`) só apareceram fazendo isso:

```bash
cd services/agent
uv run uvicorn clara.os_app:app --port 8000 &
curl http://127.0.0.1:8000/health                     # {"status":"ok",...}
curl -X POST http://127.0.0.1:8000/agui -d '{}'        # 401 sem token — esperado
```

Depois, no navegador: entre, abra `/conversa` e envie uma fatura. O caminho completo exercita as duas superfícies — token, CORS, extração, conferência e o gate de aprovação.

## Comandos disponíveis na raiz

| Comando | Função |
| --- | --- |
| `pnpm dev` | Executa as tarefas de desenvolvimento do workspace TypeScript via Turborepo |
| `pnpm dev:web` | Inicia somente o Next.js |
| `pnpm build` | Compila os pacotes e a aplicação TypeScript |
| `pnpm check-types` | Verifica os tipos em todo o workspace TypeScript |
| `pnpm test` | Executa os testes dos pacotes TypeScript |
| `pnpm test:isolation` | Executa os testes de isolamento do banco (TypeScript) |
| `pnpm db:generate` / `db:migrate` / `db:push` / `db:studio` | Drizzle — journal completo (todo o razão + auth); ver aviso em "Banco de dados" antes de rodar num banco já migrado pelo Alembic |
| `pnpm db:reset` | Zera o razão preservando login e constituição |
| `pnpm deploy:setup` / `deploy` / `deploy:prod` / `deploy:check` | Deploy Vercel do control plane |
| `pnpm env:production [--plan]` | Envia as variáveis do control plane à Vercel |

O agente Python não tem tarefas no `package.json` raiz — use `uv run` dentro de `services/agent` (veja acima), ou `docker compose up` (`services/agent/docker-compose.yml`).

## Implantação

O control plane continua em Vercel, como antes. O agente Python é um serviço `uvicorn`/Docker; a escolha de host de produção **segue em aberto** — não há URL pública deste serviço ainda. Detalhes, variáveis e armadilhas conhecidas em [docs/deploy.md](docs/deploy.md).

Não coloque arquivos `.env` ou segredos no repositório. O envio de variáveis ao control plane é por allowlist, declarada em `scripts/sync-vercel-env.ts`: uma variável fora dela não sobe — o que inclui, por construção, o papel de migração do banco.

## Decisões importantes

- **Modelo não é fonte de verdade financeira:** somas e comparações são funções puras em `clara/ledger/` (Python); o modelo interpreta e escolhe tools.
- **Aprovação é um gate real:** `requires_confirmation=True` do Agno pausa o turno de forma durável — dias, se preciso — sem manter compute ativo.
- **Proveniência é obrigatória e é imposta, não convencionada:** `require_provenance()` roda dentro de `to_tool_result()`, o ponto único por onde todo painel passa; um painel sem `transaction_ids` nunca alcança a conversa.
- **Contexto não se pede, se injeta:** o estado do razão entra pelas `instructions` dinâmicas do Agno antes do primeiro token de cada turno.
- **A mesma função serve tela e conversa:** `/inicio` e `/comparacao` chamam `clara/api/router.py`, que chama as MESMAS funções de `clara/tools/` que a conversa chama — nunca um segundo caminho de cálculo para o mesmo número.
- **Aprendizado que não se aplica é anotação:** todo `CategorizationRule` gravado por `save_concept` é consumido por `apply_learned_rules`; todo `MerchantAlias`, por `detect_recurrences`.

### Idempotência: o que está coberto e o que não está

Coberto, **por documento**: o SHA-256 do PDF com índice único `(tenant_id, content_hash)` impede o mesmo arquivo entrar duas vezes; propor de novo o mesmo documento recusa quando ele já está confirmado.

**Não coberto, por transação.** Não existe comparação de lançamentos entre lotes. O caso concreto: enviar a fatura ainda aberta, aprovar, e depois enviar a fatura fechada do mesmo ciclo. São arquivos diferentes, hashes diferentes, documentos diferentes — nada barra, e as compras que aparecem nas duas entram duas vezes no razão.

O que torna isso perigoso é que **as duas conferências passam**: o checksum prova fidelidade *documento → extração*, não consistência *extração → razão*. `propose_batch`/`propose_batch_from_extraction` avisam de **suspeitas** de dupla contagem contra o que já está confirmado (mesma data, valor e identidade de comerciante) — um aviso, não um bloqueio, porque duas compras idênticas no mesmo dia podem ser reais. Enquanto não houver supersessão de lote de verdade, a orientação é **não aprovar fatura parcial**: deixá-la como rascunho, que o snapshot mostra e permite retomar.
