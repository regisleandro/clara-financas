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

Quem tentar deployar um e depois o outro entra num vaivém de redeploys. A saída
é **nomear os dois projetos primeiro** e derivar as URLs antes de qualquer
deploy: a Vercel dá o domínio de produção a partir do nome do projeto.

```
projeto  clara-financas        →  https://clara-financas.vercel.app
projeto  clara-financas-agent  →  https://clara-financas-agent.vercel.app
```

Com os dois domínios em mãos, as variáveis já podem ser preenchidas de uma vez.

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

## Armadilhas conhecidas

**Sem `BLOB_READ_WRITE_TOKEN`, o upload quebra.** Em desenvolvimento os PDFs
vão para `.data/documents`. Num runtime serverless o sistema de arquivos é
somente-leitura fora de `/tmp`, e `/tmp` morre com a invocação. O código falha
com uma mensagem explícita (`apps/web/lib/storage.ts`) em vez de um `EROFS`
obscuro, mas o token continua sendo obrigatório.

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
