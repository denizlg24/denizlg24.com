-- `backing-up` is reported on a deployment that is already `ready`: the site is
-- serving while the recovery image is still being pushed. Nothing in this batch
-- may name the literal — Postgres allows ALTER TYPE ... ADD VALUE inside a
-- transaction but refuses to let the new value be used in the same one, and
-- drizzle runs every pending migration in one transaction.
ALTER TYPE "public"."deployment_phase" ADD VALUE 'backing-up';
