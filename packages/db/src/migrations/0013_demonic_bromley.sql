ALTER TABLE "transactions" ADD COLUMN "merchant_key" text;--> statement-breakpoint
CREATE INDEX "transactions_tenant_merchant_idx" ON "transactions" USING btree ("tenant_id","merchant_key");