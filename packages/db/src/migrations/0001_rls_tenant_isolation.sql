-- Isolamento multi-tenant no banco: camada 5 da defesa em profundidade.
--
-- É a única camada que não depende de alguém lembrar de aplicar um filtro.
-- Se o AuthFn, o guard das tools e o forTenant() falharem todos, o banco
-- ainda recusa.
--
-- Ponto que torna isto real e não decorativo: superusuário do Postgres IGNORA
-- RLS, e o dono da tabela também, a menos que se use FORCE. Por isso:
--   1. criamos um papel de aplicação SEM superusuário e SEM BYPASSRLS;
--   2. usamos FORCE ROW LEVEL SECURITY, valendo inclusive para o dono.
-- A aplicação DEVE conectar como clara_app. Conectar como `postgres` faz a
-- RLS virar enfeite.

-- ---------------------------------------------------------------------------
-- Papel de aplicação
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clara_app') THEN
    CREATE ROLE clara_app LOGIN PASSWORD 'clara_app' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO clara_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO clara_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO clara_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO clara_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO clara_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Tabelas de dados de tenant.
--
-- O tenant corrente vem de `app.tenant_id`, definido por forTenant() como
-- variável LOCAL da transação. O `true` em current_setting evita erro quando a
-- variável não existe: nesse caso o valor é NULL, a comparação não casa com
-- linha nenhuma, e o comportamento é falhar FECHADO.
-- ---------------------------------------------------------------------------
ALTER TABLE "concepts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "concepts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "concepts_tenant_isolation" ON "concepts"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "concept_revisions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "concept_revisions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "concept_revisions_tenant_isolation" ON "concept_revisions"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "agent_sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "agent_sessions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "agent_sessions_tenant_isolation" ON "agent_sessions"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- `concept_revisions` é APPEND-ONLY: é a trilha de auditoria, e trilha que se
-- reescreve não é trilha. `revert` insere uma revisão nova com um corpo
-- antigo; nunca altera nem apaga.
-- ---------------------------------------------------------------------------
REVOKE UPDATE, DELETE ON "concept_revisions" FROM clara_app;
