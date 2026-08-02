CREATE TABLE "agent_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"session_id" text NOT NULL,
	"goal_id" text NOT NULL,
	"specialist" text NOT NULL,
	"objective" text NOT NULL,
	"context_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"completion_criteria" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"result_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"missing_inputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "conversation_artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"session_id" text NOT NULL,
	"goal_id" text,
	"kind" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_goals" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"session_id" text NOT NULL,
	"intent" text NOT NULL,
	"entities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scope" jsonb,
	"completion_criteria" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "decision_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"session_id" text NOT NULL,
	"goal_id" text,
	"task_id" text,
	"operation" text NOT NULL,
	"target_ref" text NOT NULL,
	"title" text NOT NULL,
	"consequence" text NOT NULL,
	"payload" jsonb NOT NULL,
	"entity_revision" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"prepared_by" text NOT NULL,
	"decided_by" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"receipt" jsonb
);
--> statement-breakpoint
CREATE INDEX "agent_tasks_tenant_session_idx" ON "agent_tasks" USING btree ("tenant_id","session_id");--> statement-breakpoint
CREATE INDEX "agent_tasks_tenant_goal_idx" ON "agent_tasks" USING btree ("tenant_id","goal_id");--> statement-breakpoint
CREATE INDEX "agent_tasks_tenant_status_idx" ON "agent_tasks" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "conversation_artifacts_tenant_session_idx" ON "conversation_artifacts" USING btree ("tenant_id","session_id");--> statement-breakpoint
CREATE INDEX "conversation_artifacts_tenant_goal_idx" ON "conversation_artifacts" USING btree ("tenant_id","goal_id");--> statement-breakpoint
CREATE INDEX "conversation_goals_tenant_session_idx" ON "conversation_goals" USING btree ("tenant_id","session_id");--> statement-breakpoint
CREATE INDEX "conversation_goals_tenant_status_idx" ON "conversation_goals" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "decision_proposals_tenant_status_idx" ON "decision_proposals" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "decision_proposals_tenant_session_idx" ON "decision_proposals" USING btree ("tenant_id","session_id");--> statement-breakpoint
CREATE INDEX "decision_proposals_tenant_goal_idx" ON "decision_proposals" USING btree ("tenant_id","goal_id");
--> statement-breakpoint

ALTER TABLE "agent_tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_tasks" FORCE ROW LEVEL SECURITY;
CREATE POLICY "agent_tasks_tenant_isolation" ON "agent_tasks"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE ON "agent_tasks" TO clara_app;
--> statement-breakpoint

ALTER TABLE "conversation_artifacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversation_artifacts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "conversation_artifacts_tenant_isolation" ON "conversation_artifacts"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT ON "conversation_artifacts" TO clara_app;
--> statement-breakpoint

ALTER TABLE "conversation_goals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversation_goals" FORCE ROW LEVEL SECURITY;
CREATE POLICY "conversation_goals_tenant_isolation" ON "conversation_goals"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE ON "conversation_goals" TO clara_app;
--> statement-breakpoint

ALTER TABLE "decision_proposals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "decision_proposals" FORCE ROW LEVEL SECURITY;
CREATE POLICY "decision_proposals_tenant_isolation" ON "decision_proposals"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE ON "decision_proposals" TO clara_app;
