# Plan 001: Establish one-command verification (typecheck + test) in both apps

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: in `portfolio-2026/` run
> `git diff --stat b1fe917..HEAD -- package.json lib/projects.test.ts lib/github-repository-context.test.ts`
> and in `denizlg24-app/` run `git diff --stat e790966..HEAD -- package.json`.
> If any listed file changed, compare the "Current state" excerpts against the
> live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: portfolio-2026 @ `b1fe917`, denizlg24-app @ `e790966`, 2026-06-11

## Why this matters

Neither app has a `test` or `typecheck` script. Two real test files already
exist in portfolio-2026 (`lib/projects.test.ts`, `lib/github-repository-context.test.ts`,
both using `bun:test`) but there is no command that runs them, and nothing
verifies the TypeScript compiles beyond `next build`. Every other plan in
`plans/` uses `bun run typecheck` and `bun test` as verification gates, so this
plan must land first. It is intentionally tiny.

## Current state

Repo root: `E:\PersonalProjects\denizlg24.com` (NOT a git repo — the two app
directories are separate git repos). Package manager is **bun** in both apps
(`bun.lock` present). Lint is Biome.

- `portfolio-2026/package.json` — scripts today:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "biome check",
  "format": "biome format --write"
}
```

- `denizlg24-app/package.json` — identical script block (versions differ, not
  scripts).
- `portfolio-2026/lib/projects.test.ts:1` — `import { describe, expect, test } from "bun:test";`
  (so `bun test` is the intended runner).
- denizlg24-app has **zero** test files today; adding the script is still
  correct (it will report "no tests found" until plan 004 adds some — that is
  acceptable; see Step 3 for how to make it non-failing).

## Commands you will need

| Purpose | Command (run inside each app dir) | Expected on success |
|---------|-----------------------------------|---------------------|
| Install | `bun install` | exit 0 |
| Typecheck | `bun run typecheck` (added by this plan) | exit 0 |
| Tests | `bun test` | all pass (portfolio-2026: ≥2 files) |
| Lint | `bun run lint` | exit 0 (pre-existing warnings are not yours to fix) |

## Scope

**In scope** (the only files you should modify):
- `portfolio-2026/package.json`
- `denizlg24-app/package.json`

**Out of scope**:
- Fixing any type errors or lint findings these new commands reveal — REPORT
  them in your summary instead (count + first few file:line). Fixes belong to
  follow-up plans.
- Adding new tests (plan 002/004 do that).
- `biome.json` in either app — unified later by plan 003.
- `tsconfig.json` in either app.

## Git workflow

- Each app is its own git repo — commit separately in each.
- Branch: `advisor/001-verification-baseline` in each repo.
- One commit per repo, message: `chore: add typecheck and test scripts`.
- Do NOT push.

## Steps

### Step 1: Add scripts to portfolio-2026

In `portfolio-2026/package.json`, add to `"scripts"`:

```json
"typecheck": "tsc --noEmit",
"test": "bun test"
```

**Verify**: `cd portfolio-2026 && bun run typecheck; echo $?` → prints exit
code. If non-zero, record the error count and the first 5 errors in your
report, but do NOT fix them — the script addition still counts as done as
long as `tsc` itself runs (i.e. the failure is type errors, not "command not
found").

**Verify**: `cd portfolio-2026 && bun test` → runs and reports results for the
two existing test files. If any existing test FAILS, record which — do not fix.

### Step 2: Add the same scripts to denizlg24-app

Same two script entries in `denizlg24-app/package.json`.

**Verify**: `cd denizlg24-app && bun run typecheck; echo $?` → `tsc` runs
(report errors, don't fix).

### Step 3: Make `bun test` non-failing when no tests exist (denizlg24-app only)

Run `cd denizlg24-app && bun test`. If it exits non-zero solely because no
test files exist, change the script in `denizlg24-app/package.json` to:

```json
"test": "bun test || echo no tests yet"
```

is NOT acceptable (it masks real failures). Instead create a placeholder test
`denizlg24-app/lib/utils.test.ts`:

```ts
import { expect, test } from "bun:test";
import { cn } from "./utils";

test("cn merges class names", () => {
  expect(cn("a", "b")).toBe("a b");
});
```

(`cn` exists in `denizlg24-app/lib/utils.ts` — standard shadcn helper.)
This file is the one exception to the in-scope list above — creating it is
allowed.

**Verify**: `cd denizlg24-app && bun test` → 1 pass, exit 0.

## Test plan

The placeholder test in Step 3 is the only new test. Verification:
`bun test` exits 0 in denizlg24-app; in portfolio-2026 it runs the 2 existing
files (their pass/fail status is recorded, not fixed).

## Done criteria

- [ ] `cd portfolio-2026 && bun run typecheck` executes tsc (exit code recorded)
- [ ] `cd portfolio-2026 && bun test` executes the 2 existing test files
- [ ] `cd denizlg24-app && bun run typecheck` executes tsc (exit code recorded)
- [ ] `cd denizlg24-app && bun test` exits 0
- [ ] `git status` in each repo shows only in-scope files (plus the allowed placeholder test)
- [ ] `plans/README.md` status row updated, including a note listing any
      pre-existing typecheck/test failures discovered

## STOP conditions

Stop and report back if:

- `tsc` is not resolvable via `bun run typecheck` after `bun install` (would
  mean the typescript devDependency is broken — do not start installing
  packages to fix it).
- Either existing portfolio-2026 test file errors at *import time* (not an
  assertion failure) — that signals a deeper module-resolution issue.

## Maintenance notes

- Plan 003 (monorepo) hoists these scripts to root-level
  `bun run --filter` invocations; keep the per-app scripts as the source of
  truth.
- Reviewer should check that no `tsc` flags were added beyond `--noEmit`
  (the apps rely on Next's build for emit).
