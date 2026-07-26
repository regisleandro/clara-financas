CREATE TABLE "financial_action_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"operation" text NOT NULL,
	"status" text DEFAULT 'prepared' NOT NULL,
	"entity_revision" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"receipt" jsonb,
	"prepared_by" text NOT NULL,
	"applied_by" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "action_id" text;--> statement-breakpoint
ALTER TABLE "financial_action_proposals" ADD CONSTRAINT "financial_action_proposals_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "financial_actions_tenant_status_idx" ON "financial_action_proposals" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "financial_actions_batch_idx" ON "financial_action_proposals" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_actions_tenant_id_idx" ON "financial_action_proposals" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_tenant_action_idx" ON "transactions" USING btree ("tenant_id","action_id");--> statement-breakpoint
ALTER TABLE "financial_action_proposals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "financial_action_proposals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "financial_actions_tenant_isolation" ON "financial_action_proposals"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "financial_action_proposals" TO clara_app;--> statement-breakpoint
REVOKE DELETE ON "financial_action_proposals" FROM clara_app;
