# Verification baseline (plan 001, 2026-06-11)

Pre-existing typecheck/test failures recorded when the `typecheck` and `test`
scripts were added. Plans 002–004 compare against this.

## portfolio-2026 (@ b1fe917 + plan-001 commit)

- `bun run typecheck` (`tsc --noEmit`): **exit 0, 0 errors**
- `bun test`: **135 pass, 0 fail** (242 expect() calls) across **4 files**
  - Note: plan 001 expected 2 test files (`lib/projects.test.ts`,
    `lib/github-repository-context.test.ts`); 2 more test files exist on HEAD.
    All pass.

## denizlg24-app (@ e790966 + plan-001 commit)

- `bun run typecheck` (`tsc --noEmit`): **exit 0, 0 errors**
- `bun test`: **1 pass, 0 fail** — the plan-001 placeholder
  `lib/utils.test.ts` (repo had zero tests before).

## Summary

No pre-existing failures in either app. Any typecheck error or test failure
seen by later plans is a regression introduced after this baseline.
