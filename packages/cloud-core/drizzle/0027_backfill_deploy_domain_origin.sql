-- Custom SQL migration file, put your code below! --

-- `origin` defaults to 'manual' so every existing row lands there, which is the
-- safe direction to be wrong in: a generated row misread as manual just keeps
-- serving, whereas a manual row misread as generated gets retired and its DNS
-- record deleted. This reclaims the rows we can positively identify.
--
-- A domain was created automatically with its target when the label matches what
-- `createDeployTarget` derives: the project slug for the conventional `web`
-- target, and `<slug>-<target name>` for any other. Compared on the first label
-- only, so the zone name does not have to be known here — and narrowed to
-- `zone_record`, because a `custom_hostname` is by definition a name the owner
-- brought and pointed at us.
--
-- Anything that does not match stays 'manual'. Re-running is a no-op.
UPDATE "deploy_domains" AS d
SET "origin" = 'generated'
FROM "deploy_targets" AS t
  JOIN "projects" AS p ON p."id" = t."project_id"
WHERE d."target_id" = t."id"
  AND d."mode" = 'zone_record'
  AND d."origin" = 'manual'
  AND split_part(d."hostname", '.', 1) = CASE
    WHEN t."name" = 'web' THEN p."slug"
    ELSE p."slug" || '-' || t."name"
  END;
