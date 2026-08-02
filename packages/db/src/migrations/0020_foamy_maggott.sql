CREATE TABLE "agent_artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"parent_session_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "agent_artifacts_tenant_session_idx" ON "agent_artifacts" USING btree ("tenant_id","parent_session_id");--> statement-breakpoint
CREATE INDEX "agent_artifacts_tenant_expires_idx" ON "agent_artifacts" USING btree ("tenant_id","expires_at");--> statement-breakpoint

ALTER TABLE "agent_artifacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_artifacts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "agent_artifacts_tenant_isolation" ON "agent_artifacts"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));--> statement-breakpoint

REVOKE ALL ON "agent_artifacts" FROM clara_app;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "agent_artifacts" TO clara_app;
