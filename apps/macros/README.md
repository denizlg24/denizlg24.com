# Macros

Macro nutrition, micronutrient, recipe, weight trend, and weight tracking built with Next.js 16, Bun, PostgreSQL, Drizzle, Better Auth, and Resend.

## Setup

1. Install dependencies:

```bash
bun install
```

2. Add the app values from `.env.example` to the monorepo root `.env`.

```env
MACROS_DATABASE_URL=
MACROS_BETTER_AUTH_SECRET=
MACROS_BETTER_AUTH_URL=http://localhost:3000
MACROS_BETTER_AUTH_SECURE_COOKIES=false
MACROS_CRON_SECRET=
RESEND_API_KEY=
EMAIL_FROM="Macros <noreply@your-domain.com>"
NUTRITION_API_BASE_URL=https://nutrition.denizlg24.com
NUTRITION_API_KEY=
```

3. Check the committed migration history:

```bash
cd apps/macros
bunx drizzle-kit check
```

For a new local or disposable database, apply the committed migrations with
`bunx drizzle-kit migrate`. Production migrations are manual and must be
reviewed and applied before the Forge release that needs them; the app never
migrates its database at startup. If a new database does not have UUID
generation enabled, run:

```sql
create extension if not exists pgcrypto;
```

4. Start development from the monorepo root:

```bash
bun run dev:macros
```

## Scripts

- `bun run dev:macros`: start Next.js with Turbopack from the monorepo root.
- `bunx turbo typecheck --filter=macros`: run TypeScript checks.
- `bunx turbo test --filter=macros`: run tests.
- `bunx turbo lint --filter=macros`: run the root Biome checks.
- `bunx turbo build --filter=macros`: create a production build.

Production deployment and rollback steps are documented in
`../../docs/internal/deploy/macros.md`.

## Architecture Notes

- Food data is snapshotted locally from `https://nutrition.denizlg24.com`; raw API payloads are kept in JSONB and normalized nutrient rows stay queryable.
- Recipes can include foods and other recipes. Recipe nutrition is snapshotted whenever ingredients, servings, or serving labels change.
- Food and recipe log entries store display fields and nutrient rows at log time so historical logs do not change after later edits.
- Weigh-in photos store object-storage metadata in PostgreSQL. Image bytes belong in object storage, not the database.
- Weight trend points and energy expenditure estimates are modeled as per-user daily records.
