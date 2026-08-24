#!/usr/bin/env bash
# Sobe um PostgreSQL local com os DOIS papéis que o código exige e aplica as
# migrações — as DUAS: a do control plane (Drizzle, `packages/db`) e a do
# razão (Alembic, `services/agent`), no MESMO banco, tabelas disjuntas. Sem
# isto não há como verificar nada de banco: `forTenant`/`for_tenant` recusam
# conectar como superuser (a RLS viraria enfeite), então testar exige um
# papel de aplicação de verdade, separado do dono do schema.
#
#   ./scripts/dev-db.sh          # sobe, cria papéis/banco e migra os dois lados
#   ./scripts/dev-db.sh --reset  # apaga o banco antes (recomeça do zero)
#
# A migração Alembic é pulada, com aviso (não erro), se `services/agent` não
# tiver `uv` disponível ou dependências sincronizadas — quem só trabalha no
# control plane não precisa do serviço Python de pé para editar `apps/web`.
#
# Escreve as duas URLs em apps/web/.env e services/agent/.env quando elas
# ainda não existem — é de lá que os testes e o dev leem.
set -euo pipefail

DB_NAME="${CLARA_DB_NAME:-clara}"
DB_PORT="${CLARA_DB_PORT:-5432}"
APP_ROLE="clara_app"
OWNER_ROLE="clara_owner"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

psql_super() { su postgres -c "psql -qtAX -v ON_ERROR_STOP=1 $*"; }

# ---------------------------------------------------------------------------
# Senhas: geradas aqui, guardadas só no .env (que é ignorado pelo git).
#
# Nenhuma senha literal mora neste arquivo, nem mesmo uma "de brincadeira".
# Duas razões, e a segunda é a que pesa: um scanner de segredos não distingue
# senha de desenvolvimento de senha de produção — e nem deveria, porque quem lê
# o script também não distingue, e a de brincadeira acaba copiada para um lugar
# onde não é. A migração 0001 ainda define uma senha fraca de bootstrap para o
# papel de aplicação; aqui ele é criado ANTES dela, com senha própria, e o
# `IF NOT EXISTS` da migração a respeita — é o mesmo caminho que
# `docs/deploy.md` manda seguir em produção.
#
# Reaproveita a senha que já está no .env: regenerar a cada execução deixaria o
# banco e o arquivo em desacordo depois da primeira vez.
# ---------------------------------------------------------------------------
generate_password() {
  openssl rand -hex 24 2>/dev/null && return 0
  head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \n'
}

password_from_env() {
  local file="$1" key="$2" line rest
  [ -f "$file" ] || return 1
  line="$(grep -m1 "^${key}=" "$file" 2>/dev/null)" || return 1
  # postgres://<papel>:<senha>@<host>...
  rest="${line#*://*:}"
  [ "$rest" = "$line" ] && return 1
  printf '%s' "${rest%%@*}"
}

resolve_password() {
  local key="$1" found
  for file in "$ROOT/apps/web/.env" "$ROOT/services/agent/.env"; do
    if found="$(password_from_env "$file" "$key")" && [ -n "$found" ]; then
      printf '%s' "$found"
      return 0
    fi
  done
  generate_password
}

APP_PASSWORD="$(resolve_password DATABASE_URL)"
OWNER_PASSWORD="${CLARA_OWNER_PASSWORD:-$(resolve_password DATABASE_ADMIN_URL)}"

# 1. Cluster de pé -----------------------------------------------------------
if ! pg_isready -q -p "$DB_PORT" 2>/dev/null; then
  echo "Subindo o cluster PostgreSQL…"
  pg_ctlcluster "$(pg_lsclusters -h | awk 'NR==1{print $1}')" main start
  for _ in $(seq 1 30); do pg_isready -q -p "$DB_PORT" && break; sleep 1; done
fi
pg_isready -q -p "$DB_PORT" || { echo "PostgreSQL não subiu na porta $DB_PORT." >&2; exit 1; }

# 2. Papéis ------------------------------------------------------------------
# O dono do schema NÃO é superuser: se fosse, um erro de configuração que
# apontasse DATABASE_URL para ele passaria despercebido em vez de estourar.
#
# `ALTER` sempre, e não só no `CREATE`: é o que garante que o banco e o .env
# concordem mesmo quando o papel já existia de uma execução anterior — ou com a
# senha de bootstrap que a migração 0001 define.
psql_super -c "\"DO \\\$\\\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$OWNER_ROLE') THEN
    CREATE ROLE $OWNER_ROLE LOGIN CREATEDB NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$APP_ROLE') THEN
    CREATE ROLE $APP_ROLE LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END \\\$\\\$;\""

psql_super -c "\"ALTER ROLE $OWNER_ROLE WITH PASSWORD '$OWNER_PASSWORD';\"" > /dev/null
psql_super -c "\"ALTER ROLE $APP_ROLE WITH PASSWORD '$APP_PASSWORD';\"" > /dev/null

# A limpeza entre testes (`dropTenant` no lado TS, ou os fixtures de teste do lado Python)
# suspende os triggers de imutabilidade por sessão com `session_replication_role`
# — é o único jeito de apagar um tenant de teste sem afrouxar o guard que
# protege o razão confirmado, e sem o lock de tabela que o `DISABLE TRIGGER`
# tomaria. O dono do schema não é superuser de propósito, então recebe a
# permissão explicitamente.
#
# `GRANT ... ON PARAMETER` existe a partir do PostgreSQL 15; em servidor mais
# antigo a limpeza exige que `DATABASE_ADMIN_URL` aponte para um superusuário.
psql_super -c "\"DO \\\$\\\$ BEGIN
  IF current_setting('server_version_num')::int >= 150000 THEN
    EXECUTE 'GRANT SET ON PARAMETER session_replication_role TO $OWNER_ROLE';
  END IF;
END \\\$\\\$;\""

# 3. Banco -------------------------------------------------------------------
if [ "${1:-}" = "--reset" ]; then
  echo "Apagando o banco $DB_NAME…"
  psql_super -c "\"DROP DATABASE IF EXISTS $DB_NAME WITH (FORCE);\""
fi

if [ "$(psql_super -c "\"SELECT 1 FROM pg_database WHERE datname = '$DB_NAME';\"")" != "1" ]; then
  echo "Criando o banco $DB_NAME (dono: $OWNER_ROLE)…"
  psql_super -c "\"CREATE DATABASE $DB_NAME OWNER $OWNER_ROLE;\""
fi

# `unaccent` e `pg_trgm` (busca por semelhança na descrição) são extensões que
# só o superuser instala; a migração assume que já existem.
psql_super -d "$DB_NAME" -c "\"CREATE EXTENSION IF NOT EXISTS unaccent; CREATE EXTENSION IF NOT EXISTS pg_trgm;\""
psql_super -d "$DB_NAME" -c "\"GRANT ALL ON SCHEMA public TO $OWNER_ROLE;\""

ADMIN_URL="postgres://$OWNER_ROLE:$OWNER_PASSWORD@127.0.0.1:$DB_PORT/$DB_NAME"
APP_URL="postgres://$APP_ROLE:$APP_PASSWORD@127.0.0.1:$DB_PORT/$DB_NAME"

# 4. Env ---------------------------------------------------------------------
# Só acrescenta o que falta: um .env já preenchido pela pessoa não é reescrito.
ensure_env() {
  local file="$1" key="$2" value="$3"
  mkdir -p "$(dirname "$file")"
  touch "$file"
  grep -q "^$key=" "$file" || printf '%s=%s\n' "$key" "$value" >> "$file"
}

ensure_env "$ROOT/apps/web/.env" DATABASE_URL "$APP_URL"
ensure_env "$ROOT/apps/web/.env" DATABASE_ADMIN_URL "$ADMIN_URL"
ensure_env "$ROOT/services/agent/.env" DATABASE_URL "$APP_URL"
ensure_env "$ROOT/services/agent/.env" DATABASE_ADMIN_URL "$ADMIN_URL"

# 5. Migrações ---------------------------------------------------------------
#
# ATENÇÃO — as migrações Drizzle (aqui) e a migração Alembic de
# `services/agent` (Python) NÃO são complementares num banco novo: as duas
# criam as MESMAS 19 tabelas do razão, e rodar as duas em sequência falha em
# "relation already exists" assim que a segunda alcança uma tabela que a
# primeira já criou — confirmado tentando, não suposto. `packages/db` só é
# dono exclusivo de `user`/`session`/`account`/`verification` (Better Auth)
# daqui para frente; o resto é território que a Fase de reescrita Python já
# tomou.
#
# Este script aplica só o lado Drizzle. Para um banco que vai rodar
# `services/agent`, a migração Alembic é um passo SEPARADO — ver "Banco de
# dados" em README.md — e escolher entre as duas quando ambas colidem exige
# `pnpm -F @clara-financas/db db:baseline` (relatório do que já existe, e
# `--apply --through <tag>` para registrar sem reexecutar); não automatizado
# aqui porque a decisão de qual migração "venceu" cada tabela merece
# conferência humana, não uma escolha silenciosa do script.
echo "Aplicando migrações do control plane (Drizzle)…"
DATABASE_ADMIN_URL="$ADMIN_URL" DATABASE_URL="$APP_URL" \
  node --import tsx "$ROOT/packages/db/src/migrate.ts"

echo
echo "Pronto."
# A senha não é impressa: ela vive no .env, que é ignorado pelo git, e um
# terminal com histórico é tão bom lugar para guardá-la quanto um commit.
echo "  DATABASE_URL        postgres://$APP_ROLE:***@127.0.0.1:$DB_PORT/$DB_NAME"
echo "  DATABASE_ADMIN_URL  postgres://$OWNER_ROLE:***@127.0.0.1:$DB_PORT/$DB_NAME"
echo "  As duas foram escritas em apps/web/.env e services/agent/.env."
