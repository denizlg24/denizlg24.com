# Plan 005: Spike — responsive strategy for the denizlg24-app admin design + shared UI direction

> **Executor instructions**: This is a DESIGN SPIKE, not a build-everything
> plan. The deliverable is a written design doc plus ONE prototyped page.
> Follow steps in order; honor STOP conditions. When done, update the status
> row in `plans/README.md`.
>
> **Drift check (run first)**: assumes plan 003 landed (apps under `apps/`).
> Verify `apps/desktop/app/dashboard/contacts/page.tsx` and
> `apps/desktop/components/navigation/navigation-menu.tsx` exist. If the
> repo is still pre-monorepo, paths are `denizlg24-app/...` — STOP and confirm
> with the operator which layout is live.

## Status

- **Priority**: P2
- **Effort**: M (spike; the follow-up build plans it produces will be L)
- **Risk**: LOW (one prototype page + a document; easily reverted)
- **Depends on**: plans/003-monorepo-conversion.md (paths), ideally plans/004 (shared package precedent)
- **Category**: direction
- **Planned at**: denizlg24-app @ `e790966`, 2026-06-11

## Why this matters

The maintainer prefers the denizlg24-app admin design (minimalist/editorial:
`text-xs`/`text-sm`, muted secondary text, `tabular-nums`, line-variant tabs,
`h-12 border-b` header bars) over portfolio-2026's admin, and wants to
converge on it. But denizlg24-app was built desktop-only (Tauri window,
sidebar layout, data tables, fixed `h-12` headers), while the public portfolio
must stay mobile-first and any web admin would be used from phones. Before
porting anything, we need to know: which parts of the desktop design survive
contact with small viewports, what the shared UI package should contain, and
whether the portfolio's admin adopts the desktop app's pages or just its
design language.

## Current state

- `apps/desktop/` — Tauri + Next static export. Design system:
  shadcn/ui in `components/ui/`, sidebar in
  `components/navigation/navigation-menu.tsx`, command palette in
  `components/navigation/command-palette.tsx`, routes registered in
  `context/user-context.tsx` (`KNOWN_ROUTES`).
- Page pattern (per root `CLAUDE.md`): `app/dashboard/{feature}/page.tsx`,
  sub-components in `_components/`, header bar = icon + title + actions in an
  `h-12 border-b` container, TanStack `DataTable` with `SortHeader`
  (exemplars: `app/dashboard/contacts/page.tsx`, `app/dashboard/llm-usage/page.tsx`),
  content-shaped `<Skeleton>` loading states.
- `apps/web/app/admin/` — the older admin (server-backed, session
  auth). Public site lives in the same app and is mobile-first.
- Both apps carry their own copies of ~40 shadcn `components/ui/*` files —
  divergence unverified (flagged in audit as DEBT-07).
- Heavy desktop-only deps that must NOT leak into a shared UI package:
  `@fortune-sheet/react`, `react-force-graph-2d`, `@react-pdf/renderer`,
  Tauri plugins.

## Commands you will need

| Purpose | Command (repo root) | Expected on success |
|---------|---------------------|---------------------|
| Desktop dev (browser) | `bunx turbo dev --filter=desktop` | Next dev server; dashboard renders in a normal browser |
| Typecheck | `bunx turbo typecheck` | no new errors |
| Build | `bunx turbo build --filter=desktop` | exit 0 |

Note: the dashboard normally runs inside Tauri; for responsive work use the
browser at the dev URL with devtools device emulation. If pages hard-depend on
Tauri APIs at module load (not behind feature detection), record that in the
doc — it is itself a key finding for shared-UI feasibility.

## Scope

**In scope**:
- `docs/responsive-admin-design.md` (create — the main deliverable)
- `apps/desktop/app/dashboard/contacts/page.tsx` and its `_components/`
  (prototype changes only)
- `apps/desktop/components/navigation/navigation-menu.tsx` (only if the
  prototype requires a mobile nav affordance; keep changes minimal)

**Out of scope** (do NOT touch):
- Any other dashboard page (the doc PROPOSES; follow-up plans build).
- `apps/web/**` — no admin replacement in this spike.
- Creating `packages/ui` — the doc recommends its contents; creation is a
  follow-up plan.
- Visual redesign — the editorial aesthetic stays; this is about layout
  adaptation, not new design.

## Git workflow

- Branch: `advisor/005-responsive-admin-spike`.
- Commits: doc first, then prototype. Do NOT push.

## Steps

### Step 1: Audit the current desktop layout for viewport assumptions

In the browser dev server with device emulation at 375px and 768px, visit
`/dashboard`, `/dashboard/contacts`, and two more pages of your choice.
Record in the doc, per page: what breaks (sidebar, tables, fixed headers,
dialogs vs drawers, hover-only affordances, keyboard-only command palette),
and what already works.

Also run: `grep -rln "@tauri-apps" apps/desktop/app/dashboard apps/desktop/components | head -20`
to map Tauri coupling — components importing Tauri APIs cannot move into a
shared web UI package without an abstraction seam. List them in the doc.

**Verify**: doc section "Current breakage inventory" exists with ≥4 pages
assessed and the Tauri-coupling list.

### Step 2: Write the design doc

`docs/responsive-admin-design.md` must answer, with a recommendation each:

1. **Navigation**: sidebar → what on mobile? (shadcn sidebar component has
   built-in `Sheet`-based mobile behavior — check whether the app uses
   `components/ui/sidebar.tsx`'s mobile support already.)
2. **Data tables**: TanStack tables on 375px — column priority/hiding,
   card-list fallback, or horizontal scroll? Pick per-page, with the contacts
   table as the worked example.
3. **Dialogs/sheets**: which `Dialog` usages become `Drawer` (vaul is already
   a dependency) below `md:`?
4. **Shared UI package shape**: which of the ~40 `components/ui/*` files plus
   which app-level components (markdown renderer, DataTable+SortHeader,
   header-bar pattern, skeletons) belong in a future `packages/ui`; how the
   package avoids Tauri imports (findings from Step 1); whether portfolio's
   admin adopts whole pages or only the package.
5. **Breakpoint policy**: one written rule (e.g. "desktop-first inside the
   Tauri app is dead; all dashboard pages use mobile-first Tailwind with `md:`
   and `lg:` enhancements").
6. **Follow-up plan list**: 3–6 numbered follow-up plans with coarse effort
   (S/M/L) — this becomes the backlog.

**Verify**: doc contains all six sections, each ending in an explicit
**Recommendation:** line.

### Step 3: Prototype the contacts page

Apply the doc's decisions to `apps/desktop/app/dashboard/contacts/page.tsx`
only: responsive table treatment, header bar behavior, any dialog→drawer swap.
Keep the desktop (≥`lg:`) rendering visually unchanged.

**Verify**: `bunx turbo typecheck` → no new errors; `bunx turbo build --filter=desktop` →
exit 0; manual check at 375px / 768px / 1280px in browser emulation — record
a one-line result per width in the doc's appendix.

## Test plan

Spike-level: typecheck + build gates above, plus the manual three-viewport
check recorded in the doc. No new unit tests required.

## Done criteria

- [ ] `docs/responsive-admin-design.md` exists with all 6 sections + recommendations
- [ ] Tauri-coupling inventory included (grep evidence)
- [ ] Contacts page renders sensibly at 375px without horizontal body scroll
- [ ] Desktop rendering of the contacts page unchanged at ≥1280px
- [ ] `bunx turbo typecheck` and `bunx turbo build --filter=desktop` exit 0
- [ ] `git status` — only in-scope files modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The dashboard cannot run in a plain browser at all (hard Tauri dependency at
  app shell level) — the doc then pivots to "abstraction seam first" and the
  prototype step is skipped.
- The contacts page prototype requires touching >2 files outside its
  `_components/` directory.
- You find an existing responsive implementation (mobile nav, drawer usage)
  that contradicts the "desktop-only" premise — re-scope the doc to gap
  analysis instead of greenfield.

## Maintenance notes

- The doc's follow-up plan list should be turned into numbered plans
  (006+) by the advisor or operator — do not start building them in this
  spike.
- When `packages/ui` is eventually created, the DEBT-07 question (have the two
  apps' shadcn copies diverged?) must be answered by diffing before picking a
  canonical copy — note this in the doc.
