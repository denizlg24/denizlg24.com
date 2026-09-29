# Macros

Macro and micronutrient tracking, recipes, weight logging and weight-trend
estimation. Built with Next.js 16, Bun, PostgreSQL, Drizzle, Better Auth and
Resend.

This is the one multi-user application in the monorepo, so it owns its own
database rather than sharing the personal one.

## Configuration

App values live in the monorepo root `.env`, prefixed so they cannot collide
with the other applications: a database URL, the auth secret, base URL and
cookie mode, a cron secret, and credentials for transactional email and the
nutrition data API. `.env.example` lists the full set.

## Development

```sh
bun install
bun run dev:macros
```

Per-app tasks run through turbo with a `--filter=macros` scope: `typecheck`,
`test`, `lint` and `build`.

The application never migrates its database at startup, and nothing in the
deployment pipeline applies migrations either. A disposable local database is
brought up to date with `bunx drizzle-kit migrate`, and `bunx drizzle-kit check`
validates the committed history. A fresh database also needs the `pgcrypto`
extension for UUID generation.

## Scheduled jobs

Cron routes are driven by an external scheduler, authenticated with a shared
secret sent as a bearer token: a daily reset and a weight-trend recomputation,
plus the push nudges. Each route decides for itself which user-local days are
due, so invoking them more often than necessary is harmless.

Weekly target changes are not a cron. A check-in is due from the program's
check-in weekday until the owner makes one
(`/api/nutrition-programs/check-in`): the app shows the proposal, lets every
program field or the week's grams be overridden, and issues the target on
submit. Both the read and the write recompute the weight trend and expenditure
first, since those otherwise only move on a weigh-in.

## How the data model works

- Food data is snapshotted locally from the nutrition API. Raw payloads are
  kept as JSONB alongside normalized nutrient rows that stay queryable.
- Recipes can contain foods and other recipes. Recipe nutrition is
  re-snapshotted whenever ingredients, servings or serving labels change.
- Log entries store display fields and nutrient rows as they were at log time,
  so editing a food or recipe later does not silently rewrite history.
- Weigh-in photos keep object-storage metadata in PostgreSQL; the image bytes
  belong in object storage, not the database.
- Weight-trend points and energy-expenditure estimates are modelled as
  per-user daily records.
