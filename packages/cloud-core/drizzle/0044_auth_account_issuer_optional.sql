DROP INDEX "authAccount_issuer_accountId_idx";--> statement-breakpoint
ALTER TABLE "auth_account" ALTER COLUMN "issuer" DROP NOT NULL;