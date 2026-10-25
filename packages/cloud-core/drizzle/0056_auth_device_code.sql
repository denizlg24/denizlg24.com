CREATE TABLE "auth_device_code" (
	"id" text PRIMARY KEY NOT NULL,
	"device_code" text NOT NULL,
	"user_code" text NOT NULL,
	"user_id" text,
	"expires_at" timestamp NOT NULL,
	"status" text NOT NULL,
	"last_polled_at" timestamp,
	"polling_interval" integer,
	"client_id" text,
	"scope" text,
	"oauth_client_id" text,
	"resources" text[],
	CONSTRAINT "auth_device_code_device_code_unique" UNIQUE("device_code"),
	CONSTRAINT "auth_device_code_user_code_unique" UNIQUE("user_code")
);
--> statement-breakpoint
CREATE INDEX "authDeviceCode_expiresAt_idx" ON "auth_device_code" USING btree ("expires_at");