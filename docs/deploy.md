# Deploy na Vercel

A Clara são **dois deployments separados**, em dois projetos Vercel distintos:

| Projeto | O que é | Origem |
| --- | --- | --- |
| **control plane** | App Next.js: interface, login, tenants, upload | raiz do repositório |
| **agente** | Instância eve: coordenadora, extrator, analista | `packages/agent` |

Eles não são um só de propósito. O agente roda no modelo silo (Etapa 4: um
projeto por tenant), e o navegador fala com ele **cross-origin**, autenticado
por um JWT de vida curta que o control plane emite. Montar o eve dentro do Next
com `withEve` obrigaria a refazer essa integração depois — a decisão está
registrada em `apps/web/next.config.ts`.

## A dependência circular, e como sair dela

Cada plano precisa da URL do outro:

- o **agente** precisa de `APP_ORIGIN` — é a origem liberada no CORS e o issuer
  esperado do token;
- o **control plane** precisa de `NEXT_PUBLIC_AGENT_HOST` — é para onde o
  navegador abre a conexão.

Quem tentar deployar um e depois o outro entra num vaivém de redeploys.

A tentação é derivar o domínio do nome do projeto. **Não funciona**: se o nome
já estiver tomado por outra conta da Vercel, ela acrescenta um sufixo aleatório
sem avisar. Aconteceu neste projeto — `clara-financas` estava ocupado e o
domínio virou `clara-financas-six.vercel.app`. O `APP_ORIGIN` configurado por
suposição apontava para o app de um estranho, e o sintoma seria um preflight de
CORS falhando sem mensagem útil.

Crie os projetos, **leia os domínios de volta** e só então preencha:

```bash
vercel project ls
# ou, por projeto:
curl -s "https://api.vercel.com/v9/projects/<id>/domains?teamId=<team>" \
  -H "Authorization: Bearer $TOKEN" | jq '.domains[].name'
```

Os domínios reais deste deployment:

```
control plane  https://clara-financas-six.vercel.app
agente         https://clara-financas-agent.vercel.app
```

## Passo a passo

### 1. Criar e vincular os projetos

```bash
pnpm deploy:setup      # vincula a raiz ao projeto do control plane
pnpm agent:link        # `eve link`: vincula packages/agent ao projeto do agente
```

`eve link` cria ou vincula o projeto e já puxa as variáveis de ambiente dele.

### 2. Preparar o banco

O banco de produção precisa das migrações **antes** do primeiro deploy — a
aplicação não as roda sozinha.

```bash
DATABASE_ADMIN_URL='postgres://…' pnpm db:migrate
```

Depois do primeiro deploy, o CI assume: o workflow
`.github/workflows/db-migrate.yml` aplica as migrações quando um arquivo novo
em `packages/db/src/migrations/` chega à `main` (e pode ser disparado à mão
pelo `workflow_dispatch`). Ele usa o secret `DATABASE_ADMIN_URL` do
repositório — a credencial de dono continua fora da Vercel.

Dois papéis distintos, e a diferença é de segurança, não de estilo:

- `DATABASE_ADMIN_URL` — dono do schema. Só o `drizzle-kit` usa. **Nunca vai
  para a Vercel**; o script de env recusa mandá-la.
- `DATABASE_URL` — papel de aplicação (`clara_app`), sem `BYPASSRLS` e sem
  superusuário. É o que os dois projetos recebem. Conectar como `postgres` em
  produção faria a RLS virar enfeite.

A constituição não precisa de passo manual: `ensureTenant` a semeia no primeiro
login de cada pessoa e a atualiza quando a versão do bundle muda.

### 3. Preencher os `.env` locais com os valores de produção

O sync lê dos arquivos locais. Antes de rodar, ajuste `apps/web/.env` e
`packages/agent/.env` para os valores reais — o script avisa se algum ainda
aponta para `localhost`.

Os dois projetos precisam do **mesmo** `AGENT_TOKEN_SECRET`: é o segredo
compartilhado que assina e verifica o token (HS256, modo pool).

### 4. Conferir e enviar as variáveis

```bash
pnpm env:production --plan          # mostra o que iria, sem tocar na Vercel
pnpm env:agent:production --plan

pnpm env:production                 # envia
pnpm env:agent:production
```

O envio é por **allowlist**: só sai o que está declarado por plano em
`scripts/sync-vercel-env.ts`. Variável nova no `.env` não vaza sozinha para o
projeto errado — mas também não sobe sozinha, então acrescente-a à allowlist
quando ela passar a existir. O `--plan` mostra as três listas: enviadas, não
enviadas e ausentes.

#### O que cada projeto recebe

**Control plane**

| Variável | Nota |
| --- | --- |
| `DATABASE_URL` | papel de aplicação |
| `BETTER_AUTH_SECRET` | mínimo 32 caracteres |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | escopos `openid`, `email`, `profile` |
| `AGENT_TOKEN_SECRET` | **igual** ao do agente |
| `NEXT_PUBLIC_AGENT_HOST` | URL do projeto do agente |
| `BLOB_READ_WRITE_TOKEN` | **obrigatório em produção** — ver abaixo |

`BETTER_AUTH_URL` e `APP_ORIGIN` não são enviados: `packages/env/src/server.ts`
os deriva de `VERCEL_URL`.

**Agente**

| Variável | Nota |
| --- | --- |
| `DATABASE_URL` | mesmo banco, mesmo papel de aplicação |
| `AGENT_TOKEN_SECRET` | **igual** ao do control plane |
| `APP_ORIGIN` | URL do control plane; aqui **não** é derivado |
| `CLARA_MODEL` | sem default no código, por decisão |
| `CLARA_MODEL_CONTEXT_WINDOW` | o eve exige para compilar a compactação |
| `CLARA_EXTRACTOR_MODEL` | opcional: modelo mais forte só para o extrator |
| `OPENAI_API_KEY` | opcional — ver abaixo |
| `TENANT_ID` | vazio no modo pool; preenchido no silo |

### 5. Deployar

```bash
pnpm deploy:agent      # `eve deploy`: instala, builda e sobe o agente
pnpm deploy:prod       # control plane
```

### 6. Verificar

```bash
curl https://SEU-AGENTE.vercel.app/eve/v1/health
```

Depois, no navegador: entre com o Google, abra `/conversa` e envie uma fatura.
O caminho completo exercita as duas superfícies — token, CORS, extração,
conferência e gate.

Se o deploy usar Deployment Protection, defina `VERCEL_AUTOMATION_BYPASS_SECRET`
localmente antes de conectar o `eve dev` a ele.

## Configuração de projeto que não mora em arquivo

Três ajustes vivem nas configurações do projeto Vercel, não no repositório, e
sem eles o build falha de formas que não apontam para a causa:

| Ajuste | control plane | agente |
| --- | --- | --- |
| Root Directory | `apps/web` | `packages/agent` |
| Framework | `nextjs` | `eve` (detectado) |
| Build/Install Command | padrão do framework | padrão do framework |

Com Root Directory definido, o `vercel.json` é lido de DENTRO dele — um
`vercel.json` na raiz do repositório passa a ser ignorado. E o deploy pela CLI
tem de partir da **raiz do repositório** nos dois casos: rodar `vercel deploy`
de dentro de `packages/agent` com Root Directory `packages/agent` resolve o
caminho duas vezes e falha.

Para deployar o agente da raiz, aponte o projeto por variável:

```bash
VERCEL_ORG_ID=<team> VERCEL_PROJECT_ID=<projeto-do-agente> vercel deploy --prod
```

## Proteção de deployment precisa sair

A Vercel liga *Deployment Protection* (SSO) por padrão em `*.vercel.app`. Ela
**quebra a arquitetura**: o navegador fala com o agente cross-origin com Bearer
token e não carrega cookie de SSO daquele domínio, então toda conversa falha.
Desligue nos dois projetos. Quem protege o app é o login Google, o isolamento
por tenant e a RLS — não um gate da plataforma.

## Armadilhas conhecidas

**Sem `BLOB_READ_WRITE_TOKEN`, o upload quebra.** Em desenvolvimento os PDFs
vão para `.data/documents`. Num runtime serverless o sistema de arquivos é
somente-leitura fora de `/tmp`, e `/tmp` morre com a invocação. O código falha
com uma mensagem explícita (`apps/web/lib/storage.ts`) em vez de um `EROFS`
obscuro, mas o token continua sendo obrigatório.

**O papel do banco não é o que o Neon entrega.** A integração injeta
`DATABASE_URL` com o papel `neondb_owner`, dono do schema. O runtime tem de usar
`clara_app` — sem superusuário e sem `BYPASSRLS`. Sobrescreva `DATABASE_URL` nos
dois projetos depois de criar o papel. E note que a migração `0001` fixa
`PASSWORD 'clara_app'`, que qualquer Postgres gerenciado recusa por fraca: crie
o papel à mão com senha forte antes de migrar, que o `IF NOT EXISTS` da migração
a respeita.

**`OPENAI_API_KEY` presente muda o caminho do modelo.** Com a chave, o AI SDK
fala direto com a OpenAI. Sem ela, o ID de modelo é roteado pelo Vercel AI
Gateway, autenticado por OIDC do projeto — que é o caminho preferido em
produção, porque não põe chave de provedor no ambiente. O gateway exige o
prefixo (`openai/gpt-5`) e precisa conhecer o modelo; `packages/agent/agent/lib/models.ts`
normaliza entre as duas formas.

**O `AGENT_TOKEN_SECRET` divergente falha de forma silenciosa-ish.** O agente
recusa o token e a conversa nunca inicia. Se `/conversa` autentica mas nada
responde, é o primeiro lugar a olhar.

**`APP_ORIGIN` do agente precisa bater exatamente com a origem do navegador.**
É origem de CORS: `https://app.com` e `https://www.app.com` são diferentes, e o
preflight falha sem erro útil no console.

**Preview deployments têm URL variável.** O `APP_ORIGIN` fixo do agente não vai
casar com a origem de um preview do control plane. Para exercitar previews,
aponte o `NEXT_PUBLIC_AGENT_HOST` do preview para um agente de preview cujo
`APP_ORIGIN` seja aquela URL — ou teste o fluxo completo só em produção.

**Arquivo lido do disco em runtime não entra sozinho na função.** O
rastreamento do Next só segue `import`; `bundles/constitution` é lido com
`readdir`, então não era copiado para o deployment. O sintoma foi um 500 em
`/inicio` logo após o login no Google — `ENOENT: scandir
'/var/task/bundles/constitution'`, porque `getTenantContext` semeia a
constituição em toda requisição autenticada. A correção é
`outputFileTracingIncludes` em `apps/web/next.config.ts`, com
`outputFileTracingRoot` fixado na raiz do monorepo. Vale para qualquer arquivo
novo que o app leia do disco: só existe em produção se estiver declarado ali.

## Comandos

| Comando | Função |
| --- | --- |
| `pnpm deploy:setup` | Vincula a raiz ao projeto do control plane |
| `pnpm agent:link` | Vincula `packages/agent` ao projeto do agente |
| `pnpm env:production [--plan]` | Variáveis do control plane |
| `pnpm env:agent:production [--plan]` | Variáveis do agente |
| `pnpm deploy` | Deploy de preview do control plane |
| `pnpm deploy:prod` | Deploy de produção do control plane |
| `pnpm deploy:agent` | Deploy do agente (`eve deploy`) |
| `pnpm deploy:check` | Dry-run do deploy do control plane |
