# Deploy

A Clara são **dois serviços separados**, em duas linguagens:

| Serviço | O que é | Onde mora | Deploy |
| --- | --- | --- | --- |
| **control plane** | App Next.js: interface, login, tenants, upload | raiz do repositório, `apps/web` | Vercel |
| **agente** | Serviço Python (Agno + AgentOS): coordenadora, extrator, o razão inteiro | `services/agent` | **em aberto** — `uvicorn`/Docker, host ainda não escolhido |

Eles não são um só de propósito: o navegador fala com o agente **cross-origin**,
autenticado por um JWT de vida curta que o control plane emite. Essa fronteira
já existia antes da reescrita para Agno (Python) e foi preservada — juntar os
dois no mesmo processo obrigaria a desfazer depois uma decisão já registrada em
`apps/web/next.config.ts`.

**Esta seção descreve o control plane em detalhe — ele já roda em produção,
como antes.** O agente Python ainda não tem host de produção; a parte que
existe hoje é o `Dockerfile`/`docker-compose.yml` de `services/agent` e o
roteiro manual de banco em `README.md`. Ver `docs/ledger-python.md` para o
que falta antes de escolher onde hospedá-lo (a lacuna do `scripts/dev-db.sh`
não migrado, principalmente).

## A dependência circular, e como sair dela

Cada lado precisa da URL do outro:

- o **agente** precisa de `APP_ORIGIN` — é a origem liberada no CORS e o issuer
  esperado do token;
- o **control plane** precisa de `NEXT_PUBLIC_AGENT_HOST` — é para onde o
  navegador abre a conexão.

Quem tentar publicar um e depois o outro sem saber a URL final entra num
vaivém de redeploys.

A tentação é derivar o domínio do nome do projeto. **Não funciona na Vercel**:
se o nome já estiver tomado por outra conta, ela acrescenta um sufixo
aleatório sem avisar. Aconteceu neste projeto — `clara-financas` estava
ocupado e o domínio virou `clara-financas-six.vercel.app`. Um `APP_ORIGIN`
configurado por suposição apontaria para o app de um estranho, e o sintoma
seria um preflight de CORS falhando sem mensagem útil.

Crie o projeto do control plane, **leia o domínio de volta** e só então
preencha `APP_ORIGIN` no agente:

```bash
vercel project ls
# ou, por projeto:
curl -s "https://api.vercel.com/v9/projects/<id>/domains?teamId=<team>" \
  -H "Authorization: Bearer $TOKEN" | jq '.domains[].name'
```

Domínio real deste deployment:

```
control plane  https://clara-financas-six.vercel.app
```

## Passo a passo (control plane)

### 1. Criar e vincular o projeto

```bash
pnpm deploy:setup      # vincula a raiz ao projeto do control plane na Vercel
```

### 2. Preparar o banco

O banco de produção precisa das migrações **antes** do primeiro deploy — nem
o control plane nem o agente as rodam sozinhos.

```bash
DATABASE_ADMIN_URL='postgres://…' pnpm db:migrate
```

Isso aplica as tabelas que `apps/web` ainda possui pelo caminho Drizzle
(`user`, `session`, `account`, `verification`, e as telas não migradas — ver
`docs/ledger-python.md`). Depois do primeiro deploy, o CI assume: o workflow
`.github/workflows/db-migrate.yml` aplica migrações novas quando chegam à
`main`.

**O razão em si (documentos, faturas, transações, RLS, triggers de
imutabilidade) é migrado separadamente, pelo Alembic do agente Python** — ver
"Banco de dados" em `README.md`. As duas migrações apontam para o MESMO
banco, tabelas disjuntas; nenhuma delas conhece a outra.

**Banco que nasceu de `db:push`** (tabelas existem, journal vazio): o
`db:migrate` morre em "relation already exists" na migração 0000. O caminho é
o baseline — `pnpm -F @clara-financas/db db:baseline` imprime um relatório do
estado real (RLS, políticas, triggers) e, com
`--apply --through <última-tag-já-refletida>`, registra as migrações antigas
como aplicadas sem executá-las.

Dois papéis distintos, e a diferença é de segurança, não de estilo:

- `DATABASE_ADMIN_URL` — dono do schema. Só migração usa. **Nunca vai
  para a Vercel**; o script de env recusa mandá-la.
- `DATABASE_URL` — papel de aplicação (`clara_app`), sem `BYPASSRLS` e sem
  superusuário. É o que os dois serviços recebem em runtime.

A constituição não precisa de passo manual no login: `apps/web/lib/tenant.ts`
a semeia no primeiro login de cada pessoa pelo caminho TypeScript
(`packages/db/src/seed-constitution.ts`, ainda não portado — ver
`docs/ledger-python.md`).

### 3. Preencher o `.env` local com os valores de produção

O sync lê de `apps/web/.env`. Antes de rodar, ajuste-o para os valores reais
— em produção, o script recusa o env inteiro se algum valor enviado ainda
apontar para `localhost`.

`AGENT_TOKEN_SECRET` precisa ser o **mesmo** valor configurado no agente
Python, onde quer que ele esteja rodando: é o segredo compartilhado que
assina e verifica o token (HS256, modo pool).

### 4. Conferir e enviar as variáveis

```bash
pnpm env:production --plan          # mostra o que iria, sem tocar na Vercel
pnpm env:production                 # envia
```

Para alterar apenas parâmetros operacionais sem copiar banco, origem e
segredos do arquivo local, restrinja o envio à allowlist desejada:

```bash
pnpm env:production --only=GOOGLE_CLIENT_ID,GOOGLE_CLIENT_SECRET
```

O envio é por **allowlist**: só sai o que está declarado em
`scripts/sync-vercel-env.ts`. Variável nova no `.env` não vaza sozinha — mas
também não sobe sozinha, então acrescente-a à allowlist quando ela passar a
existir. O `--plan` mostra as três listas: enviadas, não enviadas e ausentes.

Em `production`, qualquer valor que aponte para localhost interrompe o sync
antes da primeira escrita.

#### O que o control plane recebe

| Variável | Nota |
| --- | --- |
| `DATABASE_URL` | papel de aplicação |
| `BETTER_AUTH_SECRET` | mínimo 32 caracteres |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | escopos `openid`, `email`, `profile` |
| `AGENT_TOKEN_SECRET` | **igual** ao do agente |
| `NEXT_PUBLIC_AGENT_HOST` | URL de onde o agente Python está servindo |
| `BLOB_READ_WRITE_TOKEN` | **obrigatório em produção** — ver abaixo |

`BETTER_AUTH_URL` e `APP_ORIGIN` não são enviados: `packages/env/src/server.ts`
os deriva de `VERCEL_URL`.

#### O que o agente Python precisa (onde quer que ele rode)

Não há projeto Vercel nem script de sync para ele — configure estas
variáveis diretamente na plataforma de host escolhida, ou via
`services/agent/docker-compose.yml`/`.env`:

| Variável | Nota |
| --- | --- |
| `DATABASE_URL` | mesmo banco, mesmo papel de aplicação |
| `AGENT_TOKEN_SECRET` | **igual** ao do control plane |
| `APP_ORIGIN` | URL do control plane; aqui **não** é derivado — é origem de CORS e issuer esperado |
| `CLARA_MODEL` / `CLARA_EXTRACTOR_MODEL` | default `gpt-5` nos dois, sem Gateway — a chave vai direto |
| `OPENAI_API_KEY` | obrigatória: sem AI Gateway configurado neste port |
| `TENANT_ID` | vazio no modo pool; preenchido no modo silo |

### 5. Deployar o control plane

```bash
pnpm deploy:prod
```

O agente Python: `docker build` + `docker run` a partir de
`services/agent/Dockerfile`, ou `docker compose up` localmente — ver
`services/agent/docker-compose.yml`. Onde hospedar em produção é decisão
ainda em aberto.

### 6. Verificar

```bash
curl https://SEU-AGENTE/health
```

Depois, no navegador: entre com o Google, abra `/conversa` e envie uma fatura.
O caminho completo exercita as duas superfícies — token, CORS, extração,
conferência e o gate de aprovação.

## Configuração de projeto que não mora em arquivo (Vercel)

Vale só para o control plane — o agente Python não é um projeto Vercel.

| Ajuste | Valor |
| --- | --- |
| Root Directory | `apps/web` |
| Framework | `nextjs` |
| Build/Install Command | padrão do framework |

Com Root Directory definido, o `vercel.json` é lido de DENTRO dele — um
`vercel.json` na raiz do repositório passa a ser ignorado.

## Proteção de deployment precisa sair (no control plane)

A Vercel liga *Deployment Protection* (SSO) por padrão em `*.vercel.app`. Ela
**quebra a arquitetura**: o navegador fala com o agente cross-origin com Bearer
token e não carrega cookie de SSO daquele domínio, então toda conversa falha.
Desligue. Quem protege o app é o login Google, o isolamento por tenant e a
RLS — não um gate da plataforma.

## Armadilhas conhecidas

**Sem `BLOB_READ_WRITE_TOKEN`, o upload quebra.** Em produção o navegador grava
direto no Blob, e é este token que assina o token de escrita de curta duração
(`/api/documents/upload`). Sem ele, `/api/documents/prepare` responde `proxy` e
o arquivo cai no caminho de desenvolvimento — que grava em `.data/documents`.
Num runtime serverless o sistema de arquivos é somente-leitura fora de `/tmp`,
e `/tmp` morre com a invocação. O código falha com uma mensagem explícita
(`apps/web/lib/storage.ts`) em vez de um `EROFS` obscuro, mas o token continua
sendo obrigatório.

**O upload direto é o que torna o limite de 20 MB verdadeiro.** Uma Vercel
Function recusa corpos de requisição acima de 4,5 MB antes de o código rodar. O
caminho `proxy` continua sujeito a esse teto — ele é de desenvolvimento, e não
deve ser alcançado em produção.

**O papel do banco não é o que o Neon entrega.** A integração injeta
`DATABASE_URL` com o papel `neondb_owner`, dono do schema. O runtime tem de usar
`clara_app` — sem superusuário e sem `BYPASSRLS`. Sobrescreva `DATABASE_URL`
nos dois serviços depois de criar o papel.

**`clara_app` precisa de `CREATE` no banco, não só no schema `agno`.** O
`PostgresDb` do Agno roda `CREATE SCHEMA IF NOT EXISTS agno` a cada boot do
agente — e o Postgres exige o privilégio `CREATE` no BANCO para essa
instrução mesmo quando o schema já existe. A migração `0001` do Alembic já
concede isso; se você criar `clara_app` por fora dela (num Postgres
gerenciado que gera o papel sozinho, por exemplo), confira que o grant existe
— sem ele o agente sobe normalmente, mas nenhuma sessão de conversa
sobrevive a um reinício do processo, e o único sinal é um `WARNING` no log.
Detalhes em `docs/ledger-python.md`.

**`OPENAI_API_KEY` ausente derruba o agente no boot.**
`clara/agents/models.py` falha cedo (`RuntimeError`) se a chave não estiver
configurada — não há AI Gateway neste port, então não há caminho alternativo
sem chave.

**`AGENT_TOKEN_SECRET` divergente falha de forma silenciosa-ish.** O agente
recusa o token e a conversa nunca inicia. Se `/conversa` autentica mas nada
responde, é o primeiro lugar a olhar.

**`APP_ORIGIN` do agente precisa bater exatamente com a origem do navegador.**
É origem de CORS: `https://app.com` e `https://www.app.com` são diferentes, e o
preflight falha sem erro útil no console.

**Preview deployments têm URL variável.** O `APP_ORIGIN` fixo do agente não vai
casar com a origem de um preview do control plane. Para exercitar previews,
aponte o `NEXT_PUBLIC_AGENT_HOST` do preview para uma instância de agente cujo
`APP_ORIGIN` seja aquela URL — ou teste o fluxo completo só em produção.

**Arquivo lido do disco em runtime não entra sozinho na função.** O
rastreamento do Next só segue `import`; `bundles/constitution` é lido com
`readdir`, então não era copiado para o deployment. O sintoma foi um 500 em
`/inicio` logo após o login no Google — `ENOENT: scandir
'/var/task/bundles/constitution'`. A correção é `outputFileTracingIncludes`
em `apps/web/next.config.ts`, com `outputFileTracingRoot` fixado na raiz do
monorepo. Vale para qualquer arquivo novo que o app leia do disco: só existe
em produção se estiver declarado ali.

## Comandos

| Comando | Função |
| --- | --- |
| `pnpm deploy:setup` | Vincula a raiz ao projeto Vercel do control plane |
| `pnpm env:production [--plan]` | Variáveis do control plane |
| `pnpm deploy` | Deploy de preview do control plane |
| `pnpm deploy:prod` | Deploy de produção do control plane |
| `pnpm deploy:check` | Dry-run do deploy do control plane |
| `docker compose up --build` (em `services/agent/`) | Sobe Postgres + o agente localmente |
