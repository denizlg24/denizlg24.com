# Macros

Macro nutrition, micronutrient, recipe, weight trend, and weight tracking built with Next.js 16, Bun, PostgreSQL, Drizzle, Better Auth, and Resend.

## Setup

1. Install dependencies:

```bash
bun install
```

2. Copy `.env.example` to `.env` and fill in the values.

```env
DATABASE_URL=
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=http://localhost:3000
RESEND_API_KEY=
EMAIL_FROM="Macros <noreply@your-domain.com>"
NUTRITION_API_BASE_URL=https://nutrition.denizlg24.com
NUTRITION_API_KEY=
```

3. Generate and apply database migrations:

```bash
bunx drizzle-kit generate
bunx drizzle-kit migrate
```

If the database does not have UUID generation enabled, run:

```sql
create extension if not exists pgcrypto;
```

4. Start development:

```bash
bun run dev
```

## Scripts

- `bun run dev`: start Next.js with Turbopack.
- `bun run typecheck`: run TypeScript checks.
- `bun run lint`: run Biome check.
- `bun run build`: create a production build.
- `bun run format`: format TypeScript and TSX files.

## Architecture Notes

- Food data is snapshotted locally from `https://nutrition.denizlg24.com`; raw API payloads are kept in JSONB and normalized nutrient rows stay queryable.
- Recipes can include foods and other recipes. Recipe nutrition is snapshotted whenever ingredients, servings, or serving labels change.
- Food and recipe log entries store display fields and nutrient rows at log time so historical logs do not change after later edits.
- Weigh-in photos store object-storage metadata in PostgreSQL. Image bytes belong in object storage, not the database.
- Weight trend points and energy expenditure estimates are modeled as per-user daily records.
