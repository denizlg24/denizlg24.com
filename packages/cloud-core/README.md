# `@repo/cloud-core`

The Pi-side database, service, middleware, search and sync code for the
self-hosted cloud.

This package is server-only. Browser applications import API contracts from
`@repo/schemas/cloud` instead — importing from here would pull database and
credential handling into a client bundle.

## Schema

`drizzle/` holds the migration history, beginning with a generated baseline of
the production schema as it stood when this package took ownership of it.
Migrations are metadata for future diffs; nothing applies them automatically.

Nothing in the deployment pipeline runs migrations — there is no release phase
— so a schema change is applied deliberately, and reviewed, before the release
that depends on it goes out. A successful deploy therefore says nothing about
whether the database has the schema the new code expects.

```sh
DATABASE_URL=postgresql://... bun run db:generate
```
