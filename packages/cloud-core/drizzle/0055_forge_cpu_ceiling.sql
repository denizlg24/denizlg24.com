-- cpu_limit becomes a burst ceiling: contention is settled by cpu.weight per
-- deployment kind, so a hard one-core quota only throttled apps on an idle host.
-- Every target still on the old default moves to the new one; a value someone
-- chose is kept. Deployments pick it up on their next deploy.
ALTER TABLE "deploy_targets" ALTER COLUMN "cpu_limit" SET DEFAULT '10.0';--> statement-breakpoint
UPDATE "deploy_targets" SET "cpu_limit" = '10.0' WHERE "cpu_limit" = '1.0';
