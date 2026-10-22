# Macros Agent Guide

## Purpose

Macros is a MacroFactor-style nutrition tracker for food logs, micronutrients, recipes, weight trends, energy expenditure estimates, and multi-angle weigh-in photo metadata.

This app is the **backend** for the iOS and Android client (`apps/macros-mobile`) plus a public marketing site. `/`, `/features`, `/coach`, `/download`, `/changelog`, `/terms`, `/privacy`, `/support`, and `/account/delete` share the `app/(site)` layout; the deletion page signs in through Better Auth and calls the same account deletion hook as the native app. `/register/*` contains the verification and password-reset pages. `/ios/source.json` remains a frozen SideStore source for existing installs, while `/android/Macros.apk` streams the newest `macros-android-v*` release asset. The iPhone app is on the App Store (`APP_STORE_HREF` in `app/ios/release.ts`); the download page and footer link there with Apple's unaltered badge artwork (`public/badges`), and the version it shows is the one Apple is serving, read from the public iTunes lookup, never App Store Connect, which would also report builds still in review. The old UDID request API, OTA install pages and TestFlight sign-up are gone. The `distribution_requests` table is retained until its rows are reviewed. `/app/*` redirects to `/` for old home-screen installs.

`/account` (dynamic, `noindex`) is the signed-in account page: name, change email (Better Auth `changeEmail`: the current address confirms, then the new one verifies), password, devices (read from the `session` table directly — `listSessions` refuses sessions older than a day and would hand tokens to the browser; one is revoked through `DELETE /api/account/sessions/[id]`), a link to `/kitchen` and inline deletion. The site header reads the session on the client so marketing pages stay static. Public recipe pages, `/recipes`, `/recipes/page/[n]`, their Open Graph images and the sitemap are static, generated at build (`generateStaticParams`, failing open to `[]` when the database is unreachable) and refreshed on demand: anything that changes a published recipe's content or visibility (edit, publish, unpublish, archive, delete, owner suspension, account deletion) calls `revalidatePublicRecipes` in `lib/recipes/revalidate.ts`. A new path to those states must call it too, or the old page stays public for up to an hour. `/changelog` and the public `GET /api/changelog` are both parsed at build from `apps/macros-mobile/CHANGELOG.md` by `@repo/utils/changelog`.

## Stack

- Next.js 16 App Router
- React 19
- Bun
- PostgreSQL
- Drizzle ORM and drizzle-kit
- Better Auth v1.6.x with the Drizzle adapter
- Resend for auth emails
- Tailwind CSS and `@repo/ui` for the marketing and `/register/*` pages (no component library of its own)

## Nutrition API Source

Use `https://nutrition.denizlg24.com` as the source for food data. Store local food and nutrition snapshots so logs and recipes are stable even if the source API changes later.

## Snapshot Policies

- Do not mutate historical food nutrition snapshots.
- Do not mutate historical recipe nutrition snapshots.
- Create a new recipe nutrition snapshot whenever recipe ingredients, serving count, or serving label changes.
- Logged foods and recipes must point at the snapshot used at log time and store display fields for history.
- Prevent recipe cycles in application or business logic before writing recipe ingredients.

## Photo Policy

Store only object-storage metadata for weigh-in photos in PostgreSQL, including URL, storage key, MIME type, dimensions, byte size, checksum, capture time, and upload time. Do not store image bytes in PostgreSQL.

## Auth Policy

Better-auth handles authentication. For now we only have email/password with Resend to send verification and password reset emails. In the future we want magic link sign-in and social logins also.

## Pantry

`lib/pantry/service.ts` stores a per-user stock checkpoint in `pantry_items`.
Quantities are servings of the stored food's serving basis; `unitLabel` and
`servingsPerUnit` name the measure stock is counted in ("head, large" = 12.48
servings of 100 g), and setting stock with a unit (plus the `basis` it was
computed against) converts into the stored basis. Food log entries and recipe
logs created after the checkpoint consume stock, including saved-meal, copied
and backdated entries; edits and deletions update the same balance. Amounts
are converted through grams where both sides have a weight
(`@repo/macros-core/pantry`), never counted serving for serving across
different units. A recipe draws on its snapshot's ingredients
(`recipe_snapshot_ingredients`, written with every recipe nutrition snapshot,
per one recipe serving), so editing a recipe never changes what an earlier log
consumed. Quick adds have no food and consume nothing. Setting stock means the
amount on hand now and starts a new checkpoint. The public balance floors at
zero without discarding overconsumption, so deleting an excessive log restores
the correct amount.

A pantry row stocks either a food or cooked servings of a recipe
(`recipeId`, quantity in recipe servings, no `item`; a check enforces one or
the other). `POST /api/pantry/recipes` stores a batch: it adds servings to
the row and, with `useIngredients`, checkpoints every stocked ingredient at
its balance less what the batch used. `PUT` sets the servings outright. A
recipe logged while it has stored servings is stamped
`food_log_entries.fromPantry` at write time (`eatsFromStoredRecipe`, also
used by copies, duplicates and saved meals): it draws the stored servings
down and never the ingredients, which the batch already used. The flag is
decided once, so later edits to the pantry never re-route an old log. A
stamped log that outlasts its stored row consumes nothing.

Recipe ingredients carry an optional `displayName` ("kidney beans" for a
brand's tin). The public page and its JSON-LD show it instead
of the food's name and brand, and `getPublicRecipe` replaces both before
anything renders. On update, an `ingredientId` row that omits `displayName`
keeps the saved one; `null` clears it.

Food search (`lib/foods/search.ts`) puts available pantry foods, history and
the owner's foods first, capped at `LOCAL_RESULT_LIMIT` and counted outside
`limit`, then the catalogue in its own relevance order — brands are never
demoted, and nothing local can push a catalogue match off the list. The
response also names stocked item ids and matching recipes. Recipe summaries
carry `pantry` coverage for one serving; recipe detail ingredients carry
`foodId` and `pantryServings`. Shopping list items carry `sourceItemId` and
accept one on create, so a bought item can be stocked.

Run the real database regression against an isolated, migrated local database:
`MACROS_PANTRY_TEST_DATABASE_URL=<local-url> bun test lib/pantry`.

## Migration Workflow

1. Edit Drizzle schema in `db/schema.ts`.
2. Run `bunx drizzle-kit generate`.
3. Review the generated SQL.
4. Run `bunx drizzle-kit migrate` against a local database.
5. Run `bun run typecheck`, `bun run lint`, and `bun run build`.

Production (`proj_macros`) is migrated by `.github/workflows/macros-migrations.yml`
on every push to `main` that touches `drizzle/`, from the `macros-db`
environment's `MACROS_DATABASE_URL`. Forge builds from the same push and never
migrates, so the old container briefly runs against the new schema: keep a
migration additive and drop columns a release later.

If `gen_random_uuid()` is unavailable in a database, enable pgcrypto:

```sql
create extension if not exists pgcrypto;
```

## Guardrails

- Do not commit `.env`.
- Do not store photo bytes in PostgreSQL.
- Do not mutate historical nutrient snapshots.
- The food log is time-based. `food_log_entries.mealType` is only a bucket derived from `eatenAt` in the user's timezone (`lib/foods/meal-bucket.ts`), recomputed on every write that sets `eatenAt`; no request schema accepts a meal. Copies keep their source's time of day on the target date, duplicates keep the original's instant.
- Account deletion is Better Auth's `/delete-user` (password required by a `hooks.before` in `lib/auth.ts`) with `beforeDelete` = `deleteAccountData` in `lib/account/delete.ts`. It clears the user's objects under `users/<id>/` in storage, then every row that points at the user's own data with `RESTRICT`, so the user-row cascade can run in one statement. Postgres checks `RESTRICT` row by row in cascade order, so a new `RESTRICT` reference between user-owned rows breaks deletion unless it is cleared there too; without the pre-step, any user with a recipe could not delete their account.
- Keep object storage credentials and upload transport out of this scaffold unless explicitly requested.
- Recipe content is the JSON block model in `@repo/schemas/macros`, never HTML. Render it through `app/_recipes/recipe-blocks.tsx` (React elements, links re-checked as http(s)); the only `dangerouslySetInnerHTML` is the recipe page's JSON-LD, with `<` escaped. A new block type needs the schema, `normalizeBlocks`, both renderers, the TipTap converter (`app/kitchen/_components/editor-doc.ts`) and the phone's `article-draft.ts`.
- **Never** use unsafe typecasts such as `as unknown as T` or `as any` if there are type erros it usually means the code is wrong or drizzle hasn't been generated.
- When committing to the repository **always** use the format `type(scope): message` in imperative form, e.g. `feat(auth): add OTP login`. Allowed types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`, `style`, `revert`. Scope is required and kebab-case. Subject is lowercase, no trailing period, max 100 chars. Longer messages go in the body after a blank line, each line starting with `- `. Enforced by commitlint via the `commit-msg` husky hook. If you are an AI model, append a footer line `Assisted by "model name" & authored by "author name"`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
