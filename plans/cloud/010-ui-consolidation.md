# Cloud 010: UI consolidation & polish

> **Executor instructions**: Follow step by step. Run every verification
> command. On STOP conditions, stop and report. When done, update
> `plans/cloud/README.md`.

## Status

- **Executor**: opus 4.8
- **Effort**: M
- **Risk**: LOW (refactor + polish; no new behavior)
- **Depends on**: 008, 009
- **Category**: UI / DX

## Why

Plans 008 and 009 were built independently for speed; both grew similar
components (auth/TOTP flows, copy-once credential displays, data tables,
empty states, confirm-by-typing dialogs). This plan de-duplicates into
shared packages and does the final quality pass before cutover.

## Scope

1. **Promote shared components**: audit both apps for duplicates; move pure
   primitives to `packages/ui`, data-aware cloud components (TOTP enrollment,
   credential copy-once panel, scope picker, task-log viewer, etc.) to a new
   `packages/cloud-ui` (`@repo/cloud-ui`, pattern mirrors `@repo/admin`:
   depends on `@repo/ui` + `@repo/schemas`, components receive the API
   client via props/context — read `plans/012-admin-ui-extraction.md`
   maintainer decisions for the established sharing model). Both apps import
   from it; zero copies left for anything used twice.
2. **Consistency pass**: typography scale, spacing, table density, focus
   states, dark mode parity, loading skeletons vs spinners (pick one
   convention), toast usage, error surfaces (zod/API errors render
   human-readable, never raw JSON).
3. **Responsive + a11y sweep**: 375/768/1280 on every screen; keyboard
   operability of browser + dialogs; labels/aria on icon buttons; contrast
   check on the chart palette.
4. **Empty/edge states**: fresh-install empty states, long-name truncation,
   huge-folder virtualization check (browser list with 5k files stays
   smooth — add virtualization if 009 didn't), offline/API-down banner with
   retry (important: the Pi may be rebooting while the Vercel UI stays up —
   every screen must degrade to a clear "cloud unreachable" state, not
   spinners).
5. **Perf**: bundle audit both apps (`next build` output), lazy-load xterm,
   pdf, and player chunks; no >250KB first-load JS regressions vs the
   scaffold baseline recorded in plan 001 (record numbers in Drift log).

## Out of scope

New features, backend changes (except trivially additive fields agreed via
Drift log), touching apps/web/desktop.

## Verification

```
bunx turbo typecheck --filter=cloud --filter=storage --filter=@repo/cloud-ui --filter=@repo/ui
bunx turbo test
bunx turbo build --filter=cloud --filter=storage   # record first-load JS sizes
bun run format-and-lint
# manual: screenshot pass at 3 widths on: dashboard, projects detail,
# browser (5k-file folder), upload in progress, share landing, terminal.
```

## STOP conditions

Runbook STOPs, plus: a "duplicate" component turns out to have subtly
different behavior between apps — reconcile only if behavior-identical is
obviously intended; otherwise report.

## Drift log

(record deviations here)
