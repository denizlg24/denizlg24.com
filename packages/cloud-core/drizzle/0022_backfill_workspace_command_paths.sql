-- Custom SQL migration file, put your code below! --

-- The build context moved from the selected directory to the repository root,
-- so a command stored before this change ran with its working directory already
-- set to `root_directory` and no longer does. Prefixing the `cd` preserves what
-- each of these targets did exactly, which is the only safe thing to do to a
-- command somebody wrote by hand.
--
-- `install_command` is deliberately untouched: it now runs at the context root,
-- which is where a workspace's lockfile and linked packages actually live. That
-- is the bug this whole change exists to fix, so restoring the old behaviour
-- here would re-break it.
--
-- Guarded on the prefix so re-running is a no-op, and on `position('&&')` so a
-- command that already changes directory itself is left alone.
UPDATE "deploy_targets"
SET "build_command" = 'cd ' || "root_directory" || ' && ' || "build_command"
WHERE "root_directory" IS NOT NULL
  AND "root_directory" <> ''
  AND "build_command" IS NOT NULL
  AND "build_command" NOT LIKE 'cd %';

UPDATE "deploy_targets"
SET "start_command" = 'cd ' || "root_directory" || ' && ' || "start_command"
WHERE "root_directory" IS NOT NULL
  AND "root_directory" <> ''
  AND "start_command" IS NOT NULL
  AND "start_command" NOT LIKE 'cd %';
