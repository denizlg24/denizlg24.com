# `@repo/cloud-core`

Pi-side database, service, middleware, search, and sync code for deniz-cloud.
This package is server-only. Vercel apps must import API contracts from
`@repo/schemas/cloud`, never from this package.

## Drizzle baseline

`drizzle/0000_serious_spiral.sql` is the generated baseline for the existing
production schema after the old `0001`–`0007` migrations. It is migration
metadata for future diffs; plan 012 decides how it is marked/applied against
the reused production database.

Generate a future migration:

```sh
DATABASE_URL=postgresql://... bun run db:generate
```

## Reproduce the old-schema parity audit

The old repository's `scripts/infra/postgres-schema.sql` is a fresh-install
snapshot that already contains migrations `0001`–`0003`, so applying all old
migrations after that file is invalid. The parity audit instead reconstructs
the real pre-`0001` schema from the parent of commit `8e7862c`, applies all
seven old migrations, and compares that database with the new schema.

1. Start the dev infrastructure from the monorepo root:

   ```sh
   cp infra/compose/.env.dev.example infra/compose/.env.dev
   bun run cloud:dev:infra
   ```

2. Export commit `8e7862c^` from the read-only submodule to a temporary
   directory outside `vendor/deniz-cloud`. From its `packages/shared`
   directory, point `DATABASE_URL` at an empty dev database and run:

   ```sh
   bunx drizzle-kit push --config drizzle.config.ts --force
   ```

3. Apply, in filename order, every SQL file from
   `vendor/deniz-cloud/packages/shared/drizzle/` with `psql
   -v ON_ERROR_STOP=1`.

4. From this package, compare without approving changes:

   ```sh
   DATABASE_URL=postgresql://... bun run db:push --strict --verbose
   ```

   Expected output: `[i] No changes detected`.

5. Confirm the committed snapshot also matches:

   ```sh
   DATABASE_URL=postgresql://... bun run db:generate
   ```

   Expected output: `No schema changes, nothing to migrate`.
