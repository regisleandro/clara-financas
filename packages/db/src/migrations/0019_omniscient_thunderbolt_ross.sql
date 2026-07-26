ALTER TABLE "agent_sessions" ADD COLUMN "active_batch_id" text;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN "focus_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_active_batch_id_batches_id_fk" FOREIGN KEY ("active_batch_id") REFERENCES "public"."batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_sessions_active_batch_idx" ON "agent_sessions" USING btree ("active_batch_id");