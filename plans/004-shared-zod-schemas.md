# Plan 004: Shared zod schema package — one source of truth for API contracts

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Operator decision baked in**: type safety via **zod** — schemas are the
> canonical contract; TypeScript types are INFERRED from them (`z.infer`).
> Plain shared interfaces (the earlier draft of this plan) were rejected.
>
> **Drift check (run first)**: this plan assumes plan 003 landed: Turborepo
> root, apps at `apps/web` (portfolio backend+site) and `apps/desktop` (Tauri
> client). Verify `turbo.json` exists, `apps/desktop/lib/data-types.ts`
> exists, and `git tag -l monorepo-cutover` shows the tag. Then
> `git diff --stat monorepo-cutover..HEAD -- apps/desktop/lib/data-types.ts apps/desktop/lib/api-wrapper.ts apps/web/models/Project.ts apps/web/lib/blog-update-schema.ts`
> — on changes, re-verify excerpts below; on mismatch, STOP.

## Status

- **Priority**: P1 (operator-elevated: this is the stated purpose of the monorepo)
- **Effort**: L
- **Risk**: MED (mechanical interface→schema conversion can subtly change types; gated by full typecheck of both apps)
- **Depends on**: plans/003-monorepo-conversion.md
- **Category**: tech-debt
- **Planned at**: portfolio-2026 @ `b1fe917`, denizlg24-app @ `e790966`, 2026-06-11 (line refs map to the ported copies under `apps/`)

## Why this matters

The desktop app hand-maintains every API type in
`apps/desktop/lib/data-types.ts`, mirroring the backend's mongoose models —
already drifted (backend `IProject` has `sourceRepository`; desktop's lacks
it). Hand-written interfaces can't catch drift at runtime either. Zod schemas
in a shared internal package give: one canonical contract, inferred types on
both sides, runtime request validation on the backend (kills the
mass-assignment bug class plan 002 patched one instance of), and optional
runtime response validation on the client (drift detected the moment it
happens, not when a page breaks).

## Current state

All paths relative to the monorepo root.

- `apps/desktop/lib/data-types.ts` — all wire interfaces (IContact, IEmail,
  IBlog, IProject, ICalendarEvent, ITimetableEntry, IWhiteboard,
  IKanbanBoard, IKanbanCard, IConversation, IResource, and the rest — open
  the file for the full list). Dates are `string` (JSON wire format) — the
  schemas keep this convention. Example shape:

```ts
// apps/desktop/lib/data-types.ts (originally lines 79-91)
export interface IContact {
  _id: string;
  ticketId: string;
  name: string;
  email: string;
  message: string;
  ipAddress: string;
  userAgent: string;
  status: "pending" | "read" | "responded" | "archived";
  emailSent: boolean;
  createdAt: string;
  updatedAt: string;
}
```

- `apps/web/models/Project.ts` (originally lines 24-36) — backend `IProject`
  includes `sourceRepository?: ISourceRepository`
  (`{ provider: "github"; owner; repo; branch }` — open the file for the
  exact shape). Desktop's IProject lacks it: the known drift to fix.
- `apps/web/lib/blog-update-schema.ts` — created by plan 002; a strict zod
  whitelist for blog PATCH. Moves into the shared package here.
- `apps/web/app/api/contact/route.ts:7-11` — inline `contactSchema` zod
  object. Moves into the shared package.
- `apps/desktop/lib/api-wrapper.ts` — `denizApi` class; all methods return
  `Promise<T | AuthError | ApiError>` and callers check `"code" in result`.
  Known defects to fix while touching it: every success path calls
  `await res.json()` unguarded (throws on non-JSON bodies, e.g. proxy HTML
  error pages); `errorFromResponse` (line ~30) same; `POST`/`PUT`/`PATCH`
  take `body: any`; catch blocks do `(error as Error).message ?? ...`.
- Both apps use zod 4.x already (`zod: ^4.3.6` pre-port; latest after plan
  003's `bun add`).
- Turborepo internal-package convention (Just-in-Time, per
  https://turborepo.dev/docs/core-concepts/internal-packages): raw `.ts` in
  `exports`, no build step, consumer transpiles; install with
  `"@repo/schemas": "workspace:*"`; Next.js consumers list it in
  `transpilePackages`.
- Test convention: `bun:test` — exemplar `apps/web/lib/projects.test.ts`.

## Commands you will need

| Purpose | Command (repo root) | Expected on success |
|---------|---------------------|---------------------|
| Install | `bun install` | exit 0 |
| Typecheck all | `bunx turbo typecheck` | no NEW errors vs plan-003 report |
| Tests | `bunx turbo test` | all pass |
| Builds | `bunx turbo build` | exit 0 both apps |
| One package | `bunx turbo typecheck --filter=@repo/schemas` | exit 0 |

## Scope

**In scope**:
- `packages/schemas/` (create — see Step 1 for the scaffold-consistent way)
- `packages/utils/` (create — shared pure functions)
- `apps/desktop/lib/data-types.ts` (becomes a re-export shim)
- `apps/desktop/lib/api-wrapper.ts` (hardening + optional schema validation)
- `apps/web/lib/blog-update-schema.ts` (delete after relocation),
  `apps/web/app/api/contact/route.ts` + `apps/web/app/api/admin/blogs/[id]/route.ts`
  (import relocation only)
- `apps/web/lib/utils.ts` (re-export shim for moved utils)
- Both apps' `package.json` (via `bun add` only) and `next.config.ts`
  (`transpilePackages`)
- One exemplar page passing a response schema (Step 5)

**Out of scope** (do NOT touch):
- `apps/web/models/**` mongoose schemas — backends keep their Document
  types; conformance between lean docs and wire schemas is follow-up work.
- Any other desktop page/component — the shim keeps imports working.
- Converting backend ROUTES to schema-validate every request — only the two
  relocations above; a full sweep is its own follow-up plan.
- `components/ui` anywhere (plan 005 territory).

## Git workflow

- Branch: `advisor/004-shared-zod-schemas` from `main`. Commit per step.
  Do NOT push.

## Steps

### Step 1: Create the two internal packages

Model both on `packages/typescript-config` (kept from the create-turbo
scaffold) for tsconfig inheritance. For each package, create the directory
with a minimal JIT manifest (this is the Turborepo-documented internal
package shape — copying the documented pattern, not inventing one):

`packages/schemas/package.json`:

```json
{
  "name": "@repo/schemas",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "bun test"
  }
}
```

Then from `packages/schemas/`: `bun add zod` and
`bun add -d typescript @types/bun` and add a `tsconfig.json` extending
`@repo/typescript-config`'s base (match how the scaffold's deleted `ui`
package did it — check `_archive` of the scaffold or the typescript-config
README; if unclear, a minimal strict tsconfig with `"include": ["src"]`).
`packages/utils/` identical with name `@repo/utils` (no zod dep).

Wire consumers: from `apps/web/` and `apps/desktop/`:
`bun add @repo/schemas@workspace:* @repo/utils@workspace:*` (if bun rejects
that form, add `"@repo/schemas": "workspace:*"` under dependencies — the
documented workspace syntax — and run `bun install`). Add
`transpilePackages: ["@repo/schemas", "@repo/utils"]` to both apps'
`next.config.ts`.

**Verify**: `bun install` exit 0; `bunx turbo typecheck --filter=@repo/schemas --filter=@repo/utils`
exit 0 (empty `src/index.ts` files are fine at this point).

### Step 2: Convert the wire types to zod schemas

In `packages/schemas/src/`, one file per domain (`contact.ts`, `blog.ts`,
`project.ts`, `calendar.ts`, `kanban.ts`, `email.ts`, `resource.ts`,
`conversation.ts`, …), re-exported from `index.ts`.

For EVERY interface in `apps/desktop/lib/data-types.ts`, produce:

```ts
// packages/schemas/src/contact.ts
import { z } from "zod";

export const contactSchema = z.object({
  _id: z.string(),
  ticketId: z.string(),
  name: z.string(),
  email: z.string(),
  message: z.string(),
  ipAddress: z.string(),
  userAgent: z.string(),
  status: z.enum(["pending", "read", "responded", "archived"]),
  emailSent: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type IContact = z.infer<typeof contactSchema>;
```

Conversion rules (apply mechanically):
- `field?: T` → `z....().optional()`. Keep optionality EXACTLY as the
  interface has it — do not "improve" the contract.
- String-literal unions → `z.enum([...])`.
- Nested object types → their own named schema in the same file.
- `Record<string, T>` → `z.record(z.string(), ...)`; arrays → `z.array(...)`.
- Keep the exported TYPE names identical to today's interface names
  (`IContact`, `IBlog`, …) so the shim in Step 3 is transparent.
- Fix the known drift: add `sourceRepositorySchema` per
  `apps/web/models/Project.ts` and include
  `sourceRepository: sourceRepositorySchema.optional()` in `projectSchema`.
- If an interface references React/Tauri/app-internal types, STOP (see STOP
  conditions).

Also relocate the two existing backend schemas:
- Move `apps/web/lib/blog-update-schema.ts` content into
  `packages/schemas/src/blog.ts` (export `blogUpdateSchema` unchanged,
  `.strict()` preserved); update the import in
  `apps/web/app/api/admin/blogs/[id]/route.ts` to `@repo/schemas`; delete the
  old file.
- Move the inline `contactSchema` (the form-input one) from
  `apps/web/app/api/contact/route.ts` as `contactInputSchema` and import it
  back. Note it differs from the entity `contactSchema` above — both live in
  `contact.ts` with distinct names.

**Verify**: `bunx turbo typecheck --filter=@repo/schemas` → exit 0;
`grep -rn "interface I" packages/schemas/src/` → no matches (schemas+infer
only); `bunx turbo typecheck --filter=web` → no new errors;
`ls apps/web/lib/blog-update-schema.ts` → gone.

### Step 3: Shim the desktop types

Replace the entire body of `apps/desktop/lib/data-types.ts` with:

```ts
export * from "@repo/schemas";
```

If `data-types.ts` contains desktop-ONLY types with no backend counterpart
(check before deleting — e.g. UI-state helper types), keep those in the shim
file below the re-export instead of moving them.

**Verify**: `bunx turbo typecheck --filter=desktop` → no NEW errors. Type
mismatches surfacing here mean the schema conversion changed a type — fix the
SCHEMA to match the original interface, never the consuming page. Then
`bunx turbo build` → both apps build.

### Step 4: Move shared utils

1. `packages/utils/src/index.ts`: move `string_to_slug`,
   `calculateReadingTime`, `getAge` from `apps/web/lib/utils.ts` (pure
   functions, no deps). Leave `cn`, `iconMap`, `ForbiddenError` in the app.
2. In `apps/web/lib/utils.ts`, re-export:
   `export { string_to_slug, calculateReadingTime, getAge } from "@repo/utils";`

**Verify**: `bunx turbo typecheck test --filter=web` → no new errors;
existing tests pass.

### Step 5: Harden the api-wrapper and add opt-in response validation

In `apps/desktop/lib/api-wrapper.ts`, public signatures stay
backward-compatible (`Promise<T | AuthError | ApiError>`):

1. Private helper:

```ts
private async parseJson<T>(res: Response): Promise<T | ApiError> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    return { message: `Non-JSON response (status ${res.status})`, code: res.status };
  }
}
```

(conform field names to the file's actual `ApiError` shape).

2. Replace every unguarded `await res.json()` (success paths and
   `errorFromResponse`) with the helper.
3. `body: any` → `body: unknown` on POST/PUT/PATCH.
4. Catch blocks: `error instanceof Error ? error.message : "An unexpected error occurred."`.
5. Add an OPTIONAL `schema` to GET:

```ts
public async GET<T>({ endpoint, schema }: { endpoint: string; schema?: ZodType<T> }): Promise<T | AuthError | ApiError> {
```

   After successful parse: if `schema` is provided, `schema.safeParse(data)`;
   on failure return
   `{ message: \`Response validation failed: ${result.error.issues[0]?.path.join(".")}\`, code: 500 }`
   (truncate to the first issue — these surface in toasts). Import `ZodType`
   (type-only) from zod.
6. Exemplar adoption: in `apps/desktop/app/dashboard/contacts/page.tsx`, pass
   a response schema to the contacts GET — build it in the page (or in
   `@repo/schemas` if a contacts-list response schema is generally useful):
   `z.object({ contacts: z.array(contactSchema), stats: ... })` matching the
   documented response shape. ONE page only.

**Verify**: `bunx turbo typecheck --filter=desktop` → clean;
`grep -n "res.json()" apps/desktop/lib/api-wrapper.ts` → no matches;
`grep -n "body: any" apps/desktop/lib/api-wrapper.ts` → no matches.

### Step 6: Tests

- `packages/schemas/src/contact.test.ts` (+ one more domain of your choice):
  valid entity parses; missing required field fails; wrong enum value fails;
  `blogUpdateSchema` still rejects unknown keys (regression for plan 002).
- `packages/utils/src/index.test.ts`: characterization tests for the three
  moved functions (derive expected values from the implementations).

**Verify**: `bunx turbo test` → all pass including new files.

## Test plan

As Step 6, plus the type-level regression that matters most: the desktop shim
means any schema change instantly typechecks every consuming page —
`bunx turbo typecheck` IS the contract test. Full gates: typecheck, test,
build across the workspace.

## Done criteria

- [ ] `packages/schemas` + `packages/utils` exist as JIT internal packages
- [ ] `grep -rn "interface I" packages/schemas/src/` → no matches; every type is `z.infer`
- [ ] `apps/desktop/lib/data-types.ts` is a re-export shim (+ desktop-only types at most)
- [ ] `grep -n "sourceRepository" packages/schemas/src/project.ts` → match (drift fixed)
- [ ] `apps/web/lib/blog-update-schema.ts` deleted; route imports `@repo/schemas`
- [ ] api-wrapper: no `res.json()`, no `body: any`; GET accepts optional schema; contacts page uses it
- [ ] `bunx turbo typecheck test build` → all green (no new failures)
- [ ] `git status` — only in-scope files modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- An interface in `data-types.ts` references React/Tauri/app-internal types —
  the package boundary needs an operator decision.
- Next.js refuses raw-TS workspace packages even with `transpilePackages`
  (would force the Compiled Package strategy — report, don't add a build
  step unilaterally).
- Step 3 typecheck reveals >10 desktop call sites broken by a corrected
  contract (i.e. the app was relying on the drifted/wrong shape at scale) —
  list them; that's a behavioral fix needing review, not a mechanical port.
- The contacts response schema (Step 5.6) FAILS against the live API in a
  dev run — that means documented shape ≠ actual shape; report the diff.
- zod's current major behaves differently from the v4 API used here (e.g.
  `z.record` signature) in a way the migration notes don't cover in one
  attempt.

## Maintenance notes

- From now on the contract workflow is: change `packages/schemas` FIRST, let
  `turbo typecheck` surface both apps' breakages. Reviewers should reject
  PRs reintroducing local wire types or hand-written response interfaces.
- Follow-up plan candidates (deliberately deferred): sweep ALL backend routes
  to `safeParse` request bodies against `@repo/schemas`; add response-schema
  usage to remaining desktop pages; conformance tests between mongoose lean
  outputs and wire schemas (needs a Date→string serialization mapping
  decision).
- Root `CLAUDE.md` documents `lib/data-types.ts` as the type home — update it
  to point at `packages/schemas`.
