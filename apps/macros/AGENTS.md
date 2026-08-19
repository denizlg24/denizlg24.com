# Macros Agent Guide

## Purpose

Macros is a **MOBILE FIRST** MacroFactor-style nutrition tracker for food logs, micronutrients, recipes, weight trends, energy expenditure estimates, and multi-angle weigh-in photo metadata.

## Stack

- Next.js 16 App Router
- React 19
- Bun
- PostgreSQL
- Drizzle ORM and drizzle-kit
- Better Auth v1.6.x with the Drizzle adapter
- Resend for auth emails
- shadcn/ui and Tailwind CSS

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
- Keep object storage credentials and upload transport out of this scaffold unless explicitly requested.
- **Never** use unsafe typecasts such as `as unknown as T` or `as any` if there are type erros it usually means the code is wrong or drizzle hasn't been generated.
- When committing to the repository **always** use the format `type(scope): message` in imperative form, e.g. `feat(auth): add OTP login`. Allowed types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`, `style`, `revert`. Scope is required and kebab-case. Subject is lowercase, no trailing period, max 100 chars. Longer messages go in the body after a blank line, each line starting with `- `. Enforced by commitlint via the `commit-msg` husky hook. If you are an AI model, append a footer line `Assisted by "model name" & authored by "author name"`.
