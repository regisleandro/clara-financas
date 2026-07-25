CREATE TABLE "transaction_reclassifications" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"transaction_id" text NOT NULL,
	"field" text NOT NULL,
	"previous_value" text,
	"new_value" text,
	"author" text NOT NULL,
	"reason" text,
	"by_concept_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transaction_reclassifications" ADD CONSTRAINT "transaction_reclassifications_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reclassifications_tenant_idx" ON "transaction_reclassifications" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "reclassifications_transaction_idx" ON "transaction_reclassifications" USING btree ("transaction_id");