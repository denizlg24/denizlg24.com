-- The first origin backfill could only recognize the default label derived
-- from the current project and target names. Target creation has always
-- accepted an explicit label, though, so those generated rows remained
-- conservatively classified as manual and could never be retired.
--
-- Creation time is the provider-independent provenance we still have: the API
-- inserts the target, commits, and immediately creates exactly one zone-record
-- domain. Existing production rows show this gap in fractions of a second;
-- ten seconds leaves room for a slow Cloudflare request while remaining far
-- below the time in which an owner can submit a second domain request.
UPDATE "deploy_domains" AS d
SET "origin" = 'generated'
FROM "deploy_targets" AS t
WHERE d."target_id" = t."id"
  AND d."mode" = 'zone_record'
  AND d."origin" = 'manual'
  AND d."created_at" >= t."created_at"
  AND d."created_at" < t."created_at" + INTERVAL '10 seconds';
