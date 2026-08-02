#!/usr/bin/env bash
# Prepara o banco do CI com os DOIS papéis que o código exige, e exporta as
# URLs para os passos seguintes do job.
#
# É o irmão de `dev-db.sh` para um serviço de container: lá o superuser é
# alcançado por `su postgres` num cluster instalado por apt; aqui é uma URL de
# rede. O resto — papéis, dono, extensões, grants — é deliberadamente o mesmo,
# porque testar contra um banco diferente do de desenvolvimento é testar outra
# coisa.
#
# Por que dois papéis e não um superuser: `forTenant`
# (packages/db/src/tenant-scope.ts) RECUSA conectar como superuser, porque com
# BYPASSRLS a política de linha vira enfeite e o `isolation.test.ts` passaria
# sem provar nada. O dono do schema também não é superuser, pelo mesmo motivo
# que em `dev-db.sh`: um erro de configuração que apontasse DATABASE_URL para
# ele precisa estourar, não passar despercebido.
#
# Uso (dentro do job):
#   CLARA_SUPERUSER_URL=postgres://postgres:...@localhost:5432/postgres \
#     ./scripts/ci-db.sh
set -euo pipefail

DB_NAME="${CLARA_DB_NAME:-clara}"
DB_HOST="${CLARA_DB_HOST:-127.0.0.1}"
DB_PORT="${CLARA_DB_PORT:-5432}"
APP_ROLE="clara_app"
OWNER_ROLE="clara_owner"

SUPER_URL="${CLARA_SUPERUSER_URL:-}"
if [ -z "$SUPER_URL" ]; then
  echo "CLARA_SUPERUSER_URL não definida (URL de superuser do serviço Postgres)." >&2
  exit 1
fi

psql_super() { psql -qtAX -v ON_ERROR_STOP=1 "$SUPER_URL" "$@"; }

# Senhas geradas a cada run. Nenhuma senha literal mora neste arquivo — mesma
# razão de `dev-db.sh`: um scanner de segredos não distingue senha de
# brincadeira de senha de verdade, e quem lê o arquivo também não.
generate_password() {
  openssl rand -hex 24 2>/dev/null && return 0
  head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \n'
}
APP_PASSWORD="$(generate_password)"
OWNER_PASSWORD="$(generate_password)"

echo "Aguardando o Postgres responder…"
for _ in $(seq 1 30); do
  psql_super -c "select 1" > /dev/null 2>&1 && break
  sleep 1
done
psql_super -c "select 1" > /dev/null

echo "Criando papéis…"
psql_super -c "DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$OWNER_ROLE') THEN
    CREATE ROLE $OWNER_ROLE LOGIN CREATEDB NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$APP_ROLE') THEN
    CREATE ROLE $APP_ROLE LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END \$\$;"

psql_super -c "ALTER ROLE $OWNER_ROLE WITH PASSWORD '$OWNER_PASSWORD';" > /dev/null
psql_super -c "ALTER ROLE $APP_ROLE WITH PASSWORD '$APP_PASSWORD';" > /dev/null

# A limpeza entre testes (`dropTenant`, packages/agent/tests/helpers/harness.ts)
# suspende os triggers de imutabilidade por sessão com `session_replication_role`
# — é o único jeito de apagar um tenant de teste sem afrouxar o guard que
# protege o razão confirmado, e sem o lock de tabela que o `DISABLE TRIGGER`
# tomaria. Superuser já pode ajustar o parâmetro; o dono do schema não é
# superuser de propósito, então recebe a permissão explicitamente.
#
# `GRANT ... ON PARAMETER` existe a partir do PostgreSQL 15. Dentro de EXECUTE
# porque em servidor mais antigo a sintaxe nem seria analisável.
psql_super -c "DO \$\$ BEGIN
  IF current_setting('server_version_num')::int >= 150000 THEN
    EXECUTE 'GRANT SET ON PARAMETER session_replication_role TO $OWNER_ROLE';
  END IF;
END \$\$;"

if [ "$(psql_super -c "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME';")" != "1" ]; then
  echo "Criando o banco $DB_NAME (dono: $OWNER_ROLE)…"
  psql_super -c "CREATE DATABASE $DB_NAME OWNER $OWNER_ROLE;"
fi

# `unaccent` e `pg_trgm` (busca por semelhança na descrição) só o superuser
# instala; as migrações assumem que já existem.
psql -qtAX -v ON_ERROR_STOP=1 "${SUPER_URL%/*}/$DB_NAME" \
  -c "CREATE EXTENSION IF NOT EXISTS unaccent; CREATE EXTENSION IF NOT EXISTS pg_trgm;" \
  -c "GRANT ALL ON SCHEMA public TO $OWNER_ROLE;"

ADMIN_URL="postgres://$OWNER_ROLE:$OWNER_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME"
APP_URL="postgres://$APP_ROLE:$APP_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME"

# Mascarar antes de exportar: sem isto a senha apareceria em qualquer log que
# ecoasse a URL (o runner do drizzle imprime a conexão em alguns erros).
echo "::add-mask::$APP_PASSWORD"
echo "::add-mask::$OWNER_PASSWORD"

if [ -n "${GITHUB_ENV:-}" ]; then
  {
    echo "DATABASE_URL=$APP_URL"
    echo "DATABASE_ADMIN_URL=$ADMIN_URL"
  } >> "$GITHUB_ENV"
  echo "DATABASE_URL e DATABASE_ADMIN_URL exportadas para os próximos passos."
else
  echo "DATABASE_URL=$APP_URL"
  echo "DATABASE_ADMIN_URL=$ADMIN_URL"
fi
