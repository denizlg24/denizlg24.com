CREATE TABLE "screen_shares" (
	"code" text PRIMARY KEY NOT NULL,
	"receiver_key" text NOT NULL,
	"sender_key" text,
	"offer" text,
	"answer" text,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "screen_shares_receiver_key_unique" UNIQUE("receiver_key"),
	CONSTRAINT "screen_shares_sender_key_unique" UNIQUE("sender_key")
);
--> statement-breakpoint
CREATE INDEX "screen_shares_expiry_idx" ON "screen_shares" USING btree ("expires_at");