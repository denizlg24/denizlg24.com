ALTER TABLE "auth_account" ADD COLUMN "issuer" text;--> statement-breakpoint
UPDATE "auth_account" SET "issuer" = CASE WHEN "provider_id" = 'credential' THEN 'local:credential' ELSE 'local:oauth:' || "provider_id" END WHERE "issuer" IS NULL;--> statement-breakpoint
ALTER TABLE "auth_account" ALTER COLUMN "issuer" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "authAccount_issuer_accountId_idx" ON "auth_account" USING btree ("issuer","account_id");
