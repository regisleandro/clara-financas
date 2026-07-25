CREATE TABLE "commitments" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"counterparty" text,
	"due_date" text NOT NULL,
	"recurrence_day_of_month" integer,
	"expected_amount" integer,
	"remind_days_before" integer DEFAULT 3 NOT NULL,
	"last_notified_for" text,
	"concept_id" text,
	"active" text DEFAULT 'yes' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "commitments_tenant_due_idx" ON "commitments" USING btree ("tenant_id","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "commitments_tenant_kind_counterparty_idx" ON "commitments" USING btree ("tenant_id","kind","counterparty");