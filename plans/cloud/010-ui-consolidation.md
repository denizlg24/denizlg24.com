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

- **Executed 2026-07-25 (opus 4.8).** `bunx turbo typecheck` (cloud, storage,
  `@repo/cloud-ui`, `@repo/ui`), `bunx turbo test`, both production builds and
  `bun run format-and-lint` are green. Deviations and notes:

  1. **Plan 001 never recorded a first-load JS baseline** (the apps were
     placeholders, and Next 16 + Turbopack no longer prints the size column at
     all). The pre-010 numbers were measured instead and are the baseline for
     future plans. Source of truth is
     `.next/diagnostics/route-bundle-stats.json` (`firstLoadUncompressedJsBytes`
     plus the gzipped sum of `firstLoadChunkPaths`); `next build` output is not
     usable for this.

     | route | before (raw/gzip kB) | after (raw/gzip kB) |
     |---|---|---|
     | cloud `/` | 1368.3 / 383.5 | 982.6 / 272.1 |
     | cloud `/settings` | 958.8 / 265.6 | 939.6 / 258.5 |
     | cloud `/login` | 947.4 / 260.5 | 927.2 / 253.4 |
     | cloud worst route | 1368.3 / 383.5 | 1075.4 / 300.1 |
     | storage `/folders/[id]` | 2082.7 / 601.3 | 1209.0 / 340.6 |
     | storage `/s/[token]` | 1784.3 / 509.6 | 888.3 / 240.6 |
     | storage `/setup-mfa` | 639.6 / 190.7 | 616.6 / 182.0 |
     | storage worst route | 2082.7 / 601.3 | 1209.0 / 340.6 |

     No route regressed. The only increases are ≤ +1.0 kB gzip on cloud routes
     that now pull the shared `@repo/cloud-ui` error/format module — far inside
     the 250 kB budget. Lazy-loaded: `recharts` (cloud dashboard),
     `highlight.js/lib/common` + `@repo/ui/markdown-renderer` (storage preview,
     which is what the share landing page inherits), and `qrcode` (both TOTP
     enrollment paths). `xterm` was already dynamically imported by 008.

  2. **`packages/cloud-ui` (`@repo/cloud-ui`)** follows the `@repo/admin` model:
     depends on `@repo/ui` + `@repo/schemas` + `@repo/cloud-auth-client`, and
     the Better Auth client is injected as a prop rather than imported, so the
     package holds no app wiring. Both apps add it to `transpilePackages` **and**
     to the `@source` globs in `globals.css` — without the second, Tailwind
     never scans the package and its classes silently vanish from the build.

  3. **Left deliberately duplicated**: `apps/*/lib/auth-client.ts` (four lines
     of app configuration, not a component) and the two `AppShell`s /
     `SessionProvider`s, which encode genuinely different policies — cloud
     demands `superuser` and bounces to `/login?enroll=1`, storage keeps the
     session on non-401 failures and routes to `/setup-mfa`. Reconciling those
     would change auth behaviour, not remove duplication.

  4. **STOP-condition call — TOTP re-enrollment differs between the apps and was
     left alone.** `apps/storage` account settings calls
     `twoFactor.disable()` before re-enrolling; `apps/cloud` settings calls
     `twoFactor.enable()` directly on an already-enrolled account. The shared
     `TotpEnrollment` component only ever calls `enable()`, so it is
     behaviour-identical in both; the difference stays in the callers where it
     already lived. Deciding which is correct is an auth-semantics change, not
     UI polish — flagged for the operator.

  5. **`formatBytes` reconciled** to the storage variant (`exponent === 0`
     rounds whole bytes, so "512 B" not "512.0 B"); every other shared formatter
     was already byte-identical. Cloud's `formatDurationMs` and storage's
     `formatDuration` are different functions with different units — both kept,
     the latter renamed `formatDurationSeconds`. `errorMessage`'s fallback is now
     "Request failed" everywhere (storage previously said "Something went
     wrong").

  6. **Large-folder virtualization** is windowing via
     `apps/storage/lib/use-windowed-rows.ts`, gated behind a 300-row threshold:
     below it every row mounts exactly as before, so the common folder takes an
     unchanged code path and only pathological folders pay for the new logic.
     Spacer rows/tiles preserve table and grid layout rather than absolute
     positioning. Keyboard navigation needed a fix either way — `focusRow` used
     `querySelector` + `scrollIntoView`, which is a silent no-op for a row that
     is not mounted; it now also computes the scroll offset directly. **This is
     the highest-risk change in the plan and is unverified in a browser** (see
     the manual pass list below).

  7. **a11y**: 21 icon-only buttons in `apps/cloud` had no accessible name;
     all now carry an `aria-label` naming the action and its target.
     `apps/storage` was already clean. `StatusDot` takes an optional `label` so
     status is not conveyed by colour alone.

  8. **Loading convention**: content-shaped skeletons via `@repo/ui/skeleton`
     wherever the layout is known; the bare pulsing dot is reserved for
     full-page auth gates before any layout exists. Storage's hand-rolled
     `animate-pulse rounded bg-muted` blocks now use the shared primitive.

  9. **Copy pass**: onboarding and "how it works" prose removed from the storage
     login/signup/enrollment/account/preview/empty-state surfaces per the
     single-user rule; cloud's terser wording became canonical. The one
     destructive-action warning (re-enrollment revoking the current
     authenticator) was kept, shortened.

  10. **Not done — needs a human at a browser.** No screenshot pass at
      375/768/1280 was possible from here. Specifically unverified: the windowed
      browser at 5k files (scroll, keyboard nav, drag-and-drop, range select,
      grid column count vs. the measured tile width), the `Unreachable` states
      with the Pi actually down, the terminal at 375px, and the chart palette's
      contrast in both themes.

- **From 008 (2026-07-24):** `apps/cloud` grew app-local primitives that are
  promotion candidates: `components/section.tsx` (heading + hairline),
  `components/status-dot.tsx` (status tones incl. `--status-*` theme tokens),
  `components/copy-button.tsx`, `components/secret-value.tsx` (copy-once
  reveal), `components/confirm-button.tsx`, `components/typed-confirm-dialog`
  (type-the-name destructive confirm), and `lib/use-poll.ts`. The chart
  palette (`--chart-1..5`) is a CVD-validated categorical set distinct from
  the desktop theme — consolidate deliberately, not by unifying hex values.
