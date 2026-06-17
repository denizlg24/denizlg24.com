# Plan 009: Consolidate note/person group traversal into a shared `@repo/utils` core

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat bbaedfe..HEAD -- apps/desktop/lib/note-group-tree.ts apps/web/lib/note-group-hierarchy.ts packages/utils/src/index.ts`
> If any of these changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch, treat
> it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED
- **Depends on**: none (the `@repo/utils` package already exists)
- **Category**: tech-debt
- **Planned at**: commit `bbaedfe`, 2026-06-17

## Why this matters

Two files independently re-implement traversal over a parent-pointer forest of
groups:

- `apps/desktop/lib/note-group-tree.ts` (103 lines) — client/UI helpers:
  group-by-id map, children-by-parent (name-sorted), ancestor chain, path-label
  map, and a descendant-id map. Used across the desktop notes + people screens.
- `apps/web/lib/note-group-hierarchy.ts` (94 lines) — server helpers: an
  ancestor map and `pruneRedundantAncestors` (used to dedupe group assignments
  on the note/people API routes), plus a `descendantIds` function.

They are **convergent, not identical** — they solve the same shape of problem
with deliberately different semantics:
- desktop ancestor/descendant helpers **include the node itself**; web's
  **exclude** it (`buildAncestorMap` returns strict ancestors,
  `descendantIds(root)` excludes the root).
- desktop assumes string `_id`; web coerces `ObjectId` via `String(...)`
  everywhere because it operates on Mongoose lean docs.
- desktop sorts children by `name`; web never reads `name`.

Because the logic is real, used on correctness-critical server paths (group
assignment dedup), and split across two runtimes, the win here is a **single,
tested, generic core** with the runtime-specific bits expressed as thin
options/adapters — not a copy-paste merge. This is a maintainability play, not
a bug fix; scoped and gated so no call-site behavior changes.

## Current state

**`apps/desktop/lib/note-group-tree.ts`** (verbatim):

```ts
import type { INoteGroup, IPersonGroup } from "@/lib/data-types";

type GroupLike = INoteGroup | IPersonGroup;

export function buildGroupById<TGroup extends GroupLike>(groups: TGroup[]) {
  return new Map(groups.map((group) => [group._id, group] as const));
}

export function buildChildrenByParent<TGroup extends GroupLike>(groups: TGroup[]) {
  const childrenByParent = new Map<string | null, TGroup[]>();
  for (const group of groups) {
    const parentId = group.parentId ?? null;
    const current = childrenByParent.get(parentId) ?? [];
    current.push(group);
    childrenByParent.set(parentId, current);
  }
  for (const children of childrenByParent.values()) {
    children.sort((left, right) => left.name.localeCompare(right.name));
  }
  return childrenByParent;
}

export function collectAncestorIds(groupId: string, byId: Map<string, GroupLike>): string[] {
  // includes groupId itself, cycle-guarded
}

export function buildPathLabelMap<TGroup extends GroupLike>(groups: TGroup[]) {
  // " / "-joined name path per group, memoized, cycle-guarded
}

export function buildDescendantIdMap<TGroup extends GroupLike>(groups: TGroup[]) {
  // Map<groupId, Set<descendantIds>> where the set INCLUDES the group itself
}
```

Desktop call sites (do not change their call signatures):
- `app/dashboard/notes/page.tsx:42,495,497` — `buildPathLabelMap`, `buildDescendantIdMap`
- `app/dashboard/notes/_components/group-tree-combobox.tsx:15-18,54-64` —
  `buildGroupById`, `buildChildrenByParent`, `buildPathLabelMap`, `collectAncestorIds`
- `app/dashboard/notes/_components/note-detail.tsx:45,170` — `buildPathLabelMap`
- `app/dashboard/notes/_components/note-folder-view.tsx:17,48` — `buildDescendantIdMap`
- `app/dashboard/people/page.tsx:40,105,107` — `buildPathLabelMap`, `buildDescendantIdMap`

**`apps/web/lib/note-group-hierarchy.ts`** (verbatim):

```ts
import type { ILeanNoteGroup } from "@/models/NoteGroup";

export type GroupLike = Pick<ILeanNoteGroup, "_id" | "parentId">;
export type AncestorMap = Map<string, Set<string>>;

export function buildAncestorMap(groups: GroupLike[]): AncestorMap {
  // memoized strict-ancestor sets (EXCLUDES self), ObjectId-coerced via String()
}

export function pruneRedundantAncestors<T extends string | { toString(): string }>(
  groupIds: T[],
  ancestorMap: AncestorMap,
): T[] {
  // removes any id that is an ancestor of another id in the list
}

export function descendantIds(rootId: string, groups: GroupLike[]): Set<string> {
  // descendants of rootId, EXCLUDES rootId
}
```

Web call sites (do not change their call signatures):
- `app/api/admin/note-groups/[id]/route.ts:5-6,71,88` — `buildAncestorMap`, `pruneRedundantAncestors`
- `app/api/admin/people/groups/[id]/route.ts:5-6,62,77` — same
- `lib/note-route-utils.ts:3-4,66,73` and `lib/people-route-utils.ts:3-4,76,83` — same
- `scripts/categorize-notes.ts:12-13,256,263` — same
- **`descendantIds`**: grep shows it is defined but **not imported anywhere**
  (likely dead). Verify in Step 1; if unused, drop it rather than porting it.

**`packages/utils/src/index.ts`** today (the consolidation target) exports
`getAge`, `string_to_slug`, `calculateReadingTime` — all pure, no deps beyond
TS. Its test file `packages/utils/src/index.test.ts` uses
`import { describe, expect, it } from "bun:test"`. The package is consumed as
`@repo/utils` (both apps already depend on it — see their `package.json`).

## Commands you will need

| Purpose                | Command (from repo root)                          | Expected          |
|------------------------|---------------------------------------------------|-------------------|
| Typecheck whole graph  | `bunx turbo run typecheck`                        | exit 0 all packages |
| Utils package tests    | `cd packages/utils && bun test`                   | all pass          |
| Web tests              | `cd apps/web && bun test --env-file=../../.env`   | all pass          |
| Desktop tests          | `cd apps/desktop && bun test`                     | all pass          |
| Lint/format            | `bun run format-and-lint`                          | exit 0            |

## Scope

**In scope**:
- `packages/utils/src/group-forest.ts` (create — the generic core)
- `packages/utils/src/group-forest.test.ts` (create — tests for the core)
- `packages/utils/src/index.ts` (modify — re-export the new module)
- `apps/desktop/lib/note-group-tree.ts` (rewrite as thin adapters over the core,
  **keeping every exported function's name and signature identical**)
- `apps/web/lib/note-group-hierarchy.ts` (rewrite as thin adapters over the
  core, **keeping every exported function's name and signature identical**)

**Out of scope** (do NOT touch):
- Every call site listed above. Public signatures of the two lib files MUST NOT
  change, so no call site needs editing. If you find yourself editing a call
  site, you have changed a signature — STOP.
- `packages/schemas` and the `INoteGroup`/`IPersonGroup`/`ILeanNoteGroup` types.
- Behavior: self-inclusion, name-sorting, and ObjectId coercion must be
  preserved exactly per the existing semantics.

## Git workflow

- Branch: `advisor/009-note-group-forest-utils-consolidation`
- Commit style: conventional commits, e.g.
  `refactor: extract group-forest traversal into @repo/utils`.
- Suggested commit order: (1) add `@repo/utils` core + tests, (2) rewrite web
  adapter, (3) rewrite desktop adapter. The repo is type-checkable after each.
- Do NOT push or open a PR unless the operator instructs it.

## Steps

### Step 1: Confirm `descendantIds` is dead, and read both files in full

Run `grep -rn "descendantIds" apps/web --include="*.ts" | grep -v node_modules
| grep -v ".next"`. If the only match is its definition in
`note-group-hierarchy.ts`, it is dead code — you will drop it (not port it) in
Step 4. If it has a real importer, STOP and report (the plan assumed it was
unused). Open both source files completely before writing the core, so the
generic API actually covers every existing function.

**Verify**: you can list, for each of the 8 exported functions across the two
files, which generic primitive will back it.

### Step 2: Write the generic core in `@repo/utils`

Create `packages/utils/src/group-forest.ts` with a small set of generic,
dependency-free primitives parameterized by id/parent accessors and explicit
inclusion options. Suggested API (adjust names if cleaner, but cover all cases):

```ts
export interface ForestNode {
  // callers pass accessors; the core never assumes a concrete shape
}

// Build a Map id -> node.
export function indexById<T>(nodes: T[], getId: (n: T) => string): Map<string, T>;

// Map parentId(or null) -> children, with optional comparator for ordering.
export function groupByParent<T>(
  nodes: T[],
  getId: (n: T) => string,
  getParentId: (n: T) => string | null,
  compare?: (a: T, b: T) => number,
): Map<string | null, T[]>;

// Ancestor ids walking parent pointers; includeSelf toggles desktop vs web.
export function ancestorIds(
  startId: string,
  parentOf: (id: string) => string | null,
  opts: { includeSelf: boolean },
): string[];

// Descendant id set; includeRoot toggles desktop (true) vs web (false).
export function descendantIdSet<T>(
  rootId: string,
  childrenByParent: Map<string | null, T[]>,
  getId: (n: T) => string,
  opts: { includeRoot: boolean },
): Set<string>;
```

All traversal must be **cycle-guarded** (the existing code uses `visited`
sets / `seen` sets — preserve that; a malformed parent cycle must not infinite-
loop). Keep everything pure and synchronous.

**Verify**: `cd packages/utils && bun run typecheck` → exit 0.

### Step 3: Test the core directly

Create `packages/utils/src/group-forest.test.ts` (model after
`packages/utils/src/index.test.ts`: `import { describe, expect, it } from "bun:test"`).
Cover, with a small fixture forest (root → child → grandchild, plus a sibling):
- `groupByParent` groups correctly and applies the comparator (name order).
- `ancestorIds` with `includeSelf: true` vs `false` (the two semantics).
- `descendantIdSet` with `includeRoot: true` vs `false`.
- A **cycle** fixture (A.parent = B, B.parent = A) terminates and returns a
  bounded result for both ancestor and descendant traversal.
- Empty input returns empty maps/sets.

**Verify**: `cd packages/utils && bun test group-forest.test.ts` → all pass.

### Step 4: Re-export from `@repo/utils` and rewrite the web adapter

Add `export * from "./group-forest";` to `packages/utils/src/index.ts`.

Rewrite `apps/web/lib/note-group-hierarchy.ts` so each **still-exported**
function (`buildAncestorMap`, `pruneRedundantAncestors`, and the `GroupLike` /
`AncestorMap` types) delegates to the core, preserving exact behavior:
ObjectId→`String()` coercion in the accessors, strict ancestors (`includeSelf:
false`). Drop `descendantIds` only if Step 1 proved it dead. `pruneRedundantAncestors`
stays in this file (it is web-specific dedup logic built on `AncestorMap`) — or
move it to the core if it is fully generic; either is fine as long as the web
import path keeps working.

**Verify**:
- `cd apps/web && bun run typecheck` → exit 0
- `cd apps/web && bun test --env-file=../../.env` → all pass (existing
  route/util tests unaffected; `--env-file` loads the root `.env` so the
  mongodb-coupled modules don't throw at load)

### Step 5: Rewrite the desktop adapter

Rewrite `apps/desktop/lib/note-group-tree.ts` so each exported function
(`buildGroupById`, `buildChildrenByParent`, `collectAncestorIds`,
`buildPathLabelMap`, `buildDescendantIdMap`) delegates to the core, preserving:
name-sorted children, ancestor chain **including self**, descendant map
**including self**, and the `" / "` path-label join. Keep the
`INoteGroup | IPersonGroup` generic constraint and identical signatures so the 5
call sites compile unchanged.

**Verify**:
- `cd apps/desktop && bun run typecheck` → exit 0
- `cd apps/desktop && bun test` → all pass

### Step 6: Full graph gates

**Verify**:
- `bunx turbo run typecheck` → exit 0 for all packages
- `bun run format-and-lint` → exit 0

## Test plan

- New: `packages/utils/src/group-forest.test.ts` — cases in Step 3, including
  the two inclusion-semantics toggles and the cycle guard (the behaviors most
  likely to regress in a merge).
- Existing tests are the safety net for call-site behavior: the web route/util
  tests and desktop `lib/utils.test.ts` must stay green, proving signatures and
  semantics are unchanged.
- Pattern to copy: `packages/utils/src/index.test.ts`.

## Done criteria

ALL must hold:

- [ ] `packages/utils/src/group-forest.ts` exists and is re-exported from `index.ts`
- [ ] `apps/desktop/lib/note-group-tree.ts` and
      `apps/web/lib/note-group-hierarchy.ts` delegate to the core; **no exported
      signature changed**
- [ ] `git diff --name-only bbaedfe..HEAD` shows **no** changes under the call-site
      files listed in Scope (only the 5 in-scope files changed)
- [ ] `bunx turbo run typecheck` exits 0
- [ ] `cd packages/utils && bun test` passes incl. new group-forest tests
- [ ] `cd apps/web && bun test --env-file=../../.env` and `cd apps/desktop && bun test` pass
- [ ] `bun run format-and-lint` exits 0
- [ ] `plans/README.md` status row for 009 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `descendantIds` turns out to have a real importer (Step 1) — port vs. drop is
  then a decision, not an assumption.
- Preserving exact behavior would require changing any exported signature or any
  call site — the consolidation is then not behavior-preserving; report the
  specific conflict instead of forcing it.
- The two semantics (self-inclusion / ObjectId coercion) cannot be expressed via
  the core's options without branching that recreates the duplication — report;
  a partial consolidation (core + one adapter) may be the honest outcome.
- Any existing test flips from pass to fail.

## Maintenance notes

- This is intentionally a **behavior-preserving** refactor: the public API of
  both lib files is frozen so call sites are untouched. A reviewer should verify
  the diff contains only the 5 in-scope files.
- Honest trade-off (surfaced during planning): the two files share no identical
  lines today — they are convergent, not duplicated. The payoff is one tested
  home for forest traversal and a place for future group/tree code to land
  (the broader "shared-utils sweep" direction item). If the executor finds the
  generic core fighting the two semantics, a smaller win (core + web adapter
  only) is acceptable and should be reported, not forced.
- Future group-traversal needs in either app should import from `@repo/utils`
  rather than adding a third copy.
