ALTER TABLE "conversation_artifacts" ALTER COLUMN "version" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "batches" ADD COLUMN "opening_balance" bigint;--> statement-breakpoint
ALTER TABLE "batches" ADD COLUMN "closing_balance" bigint;