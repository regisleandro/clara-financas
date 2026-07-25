CREATE TABLE "batches" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"document_id" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"period_start" text,
	"period_end" text,
	"due_date" text,
	"declared_total" bigint,
	"extracted_total" bigint,
	"checksum_result" text,
	"checksum_report" jsonb,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"kind" text NOT NULL,
	"blob_key" text NOT NULL,
	"filename" text NOT NULL,
	"issuer" text,
	"content_hash" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"date" text NOT NULL,
	"original_description" text NOT NULL,
	"merchant" text,
	"amount" bigint NOT NULL,
	"kind" text DEFAULT 'purchase' NOT NULL,
	"installment_current" integer,
	"installment_total" integer,
	"category" text,
	"extraction_confidence" text NOT NULL,
	"source_document_id" text NOT NULL,
	"page" integer,
	"adjusts_transaction_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_source_document_id_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "batches_tenant_status_idx" ON "batches" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "batches_document_idx" ON "batches" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "documents_tenant_idx" ON "documents" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_tenant_hash_idx" ON "documents" USING btree ("tenant_id","content_hash");--> statement-breakpoint
CREATE INDEX "transactions_tenant_status_idx" ON "transactions" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "transactions_batch_idx" ON "transactions" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "transactions_tenant_date_idx" ON "transactions" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE INDEX "transactions_adjusts_idx" ON "transactions" USING btree ("adjusts_transaction_id");