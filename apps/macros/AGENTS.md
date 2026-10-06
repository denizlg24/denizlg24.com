# Macros Agent Guide

## Purpose

Macros is a MacroFactor-style nutrition tracker for food logs, micronutrients, recipes, weight trends, energy expenditure estimates, and multi-angle weigh-in photo metadata.

This app is the **backend** for the iOS and Android client (`apps/macros-mobile`) plus a public marketing site. `/`, `/features`, `/coach`, `/download`, `/changelog`, `/terms`, `/privacy`, `/support`, and `/account/delete` share the `app/(site)` layout; the deletion page signs in through Better Auth and calls the same account deletion hook as the native app. `/register/*` contains the verification and password-reset pages. `/ios/source.json` remains a frozen SideStore source for existing installs, while `/android/Macros.apk` streams the newest `macros-android-v*` release asset. The iOS release goes through TestFlight and the App Store; the old UDID request API and OTA install pages are gone. The `distribution_requests` table is retained until its rows are reviewed. `/app/*` redirects to `/` for old home-screen installs. `/changelog` and the public `GET /api/changelog` are both parsed at build from `apps/macros-mobile/CHANGELOG.md` by `@repo/utils/changelog`.

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

## Migration Workflow

1. Edit Drizzle schema in `db/schema.ts`.
2. Run `bunx drizzle-kit generate`.
3. Review the generated SQL.
4. Run `bunx drizzle-kit migrate`.
5. Run `bun run typecheck`, `bun run lint`, and `bun run build`.

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
- **Never** use unsafe typecasts such as `as unknown as T` or `as any` if there are type erros it usually means the code is wrong or drizzle hasn't been generated.
- When committing to the repository **always** use the format `type(scope): message` in imperative form, e.g. `feat(auth): add OTP login`. Allowed types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`, `style`, `revert`. Scope is required and kebab-case. Subject is lowercase, no trailing period, max 100 chars. Longer messages go in the body after a blank line, each line starting with `- `. Enforced by commitlint via the `commit-msg` husky hook. If you are an AI model, append a footer line `Assisted by "model name" & authored by "author name"`.
