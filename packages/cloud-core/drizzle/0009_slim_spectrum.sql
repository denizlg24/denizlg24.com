CREATE TABLE "namespace_projection_errors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"relative_path" text NOT NULL,
	"entry_id" uuid,
	"code" varchar(64) NOT NULL,
	"detail" text,
	"first_seen_generation" bigint,
	"last_seen_generation" bigint,
	"repaired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "namespace_projection_errors_relative_path_unique" UNIQUE("relative_path")
);
--> statement-breakpoint
CREATE TABLE "namespace_projection_state" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"dirty" boolean DEFAULT true NOT NULL,
	"dirty_since" timestamp with time zone,
	"dirty_reason" text,
	"last_complete_generation" bigint,
	"last_complete_at" timestamp with time zone,
	"last_event_at" timestamp with time zone,
	"watcher_overflows" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "namespace_reap_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"kind" varchar(16) NOT NULL,
	"relative_path" text NOT NULL,
	"first_missed_generation" bigint NOT NULL,
	"last_missed_generation" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "namespace_reap_candidates_entry_id_unique" UNIQUE("entry_id")
);
--> statement-breakpoint
CREATE TABLE "namespace_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"generation" bigint NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"complete" boolean DEFAULT false NOT NULL,
	"branch_markers" jsonb,
	"folders_seen" integer DEFAULT 0 NOT NULL,
	"files_seen" integer DEFAULT 0 NOT NULL,
	"problems_seen" integer DEFAULT 0 NOT NULL,
	"reaped_rows" integer DEFAULT 0 NOT NULL,
	"search_task_uid" bigint,
	"abort_reason" text,
	CONSTRAINT "namespace_scans_generation_unique" UNIQUE("generation")
);
--> statement-breakpoint
CREATE INDEX "namespace_projection_errors_code_idx" ON "namespace_projection_errors" USING btree ("code");--> statement-breakpoint
CREATE INDEX "namespace_projection_errors_repaired_at_idx" ON "namespace_projection_errors" USING btree ("repaired_at");--> statement-breakpoint
CREATE INDEX "namespace_reap_candidates_entry_idx" ON "namespace_reap_candidates" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "namespace_scans_generation_idx" ON "namespace_scans" USING btree ("generation");--> statement-breakpoint
CREATE INDEX "namespace_scans_started_at_idx" ON "namespace_scans" USING btree ("started_at");