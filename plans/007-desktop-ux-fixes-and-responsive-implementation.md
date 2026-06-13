# Plan 007: Desktop UX fixes + responsive admin implementation

> **Executor instructions**: This is an umbrella plan in ordered phases. Each
> phase is independently landable (own commit/branch, own verification gate).
> Do NOT start a phase until the previous phase's gate passed, except where a
> phase is explicitly marked parallel-safe. Honor STOP conditions. When a
> phase lands, update the status table below AND the row in `plans/README.md`.
>
> This plan subsumes the follow-up list 007–012 proposed in
> `docs/responsive-admin-design.md` §6 — those numbers become phases R1–R6
> here; do not create separate plan files for them.
>
> **Drift check (run first)**: verify these exist:
> - `docs/responsive-admin-design.md`
> - `apps/desktop/components/graph/knowledge-graph.tsx`
> - `apps/desktop/app/dashboard/notes/_components/find-replace-bar.tsx`
> - `apps/desktop/components/ui/paginated-data-table.tsx`
>
> If any moved, locate the new home before editing. All file:line references
> below were verified 2026-06-12 on `main` @ `5efe4fb`.

## Status

| Phase | Title | Effort | Status |
|-------|-------|--------|--------|
| F1 | Note editor: find bar position + scroll-to-occurrence | M | DONE (2026-06-12: root cause differed from plan — page is an intentional document-scroll, not a broken height chain; maintainer chose sticky find bar + scrolling the actual ancestor scroller via mirror-div measurement; verified with puppeteer harness, all matches land 3 lines below viewport top incl. soft-wrapped) |
| F2 | Graph: double force explosion + notes/people alignment | M | DONE (2026-06-12: engine now paused (cooldownTicks 0) until custom forces install, then single reheat; getters hoisted to module scope; page plumbing was already near-identical → extracted `useEntityGraphData`; prod-export verified 1 settle burst on notes+people, filter re-settles once) |
| F3 | Skeleton fidelity sweep | M | DONE (2026-06-12: shared blocks in `components/ui/skeleton-blocks.tsx` (HeaderBar/StatStrip/TabStrip/Table/ListRows); rewrote llm-usage (was missing tabs+chart+table), contacts/blog/comments (tab strip + real table chrome), projects/timeline (stats count + row heights 61/81px), spreadsheets (stats+table, was misshapen), now (full-height editor), people (missing filter row), notes (row height); harness-measured drift ≤13px, was whole-sections-missing; triage/settings already content-shaped, kept; dashboard-summary deferred to F4, chat-view/sub-resources/sheet-editor to F7) |
| F4 | Upcoming tasks: port web presentation to desktop | M | DONE (2026-06-12: upcoming-kanban wire schemas in `@repo/schemas` kanban.ts, both local interface sets deleted, desktop fetch zod-validated; tasks tab gained stats line, board color dots, left rail, column titles, web's due wording; caps kept at 3 boards × 3 cards with explicit +N indicators (glance widget); verified empty/overdue-only/4-board fixtures; dashboard skeleton gained switcher block) |
| F5 | Shared table filtering + LLM usage page upgrade | M | DONE (2026-06-12: PaginatedDataTable gained getFilteredRowModel + opt-in toolbar (global search Input + faceted Selects from getFacetedUniqueValues), zero change for non-opted pages; contacts/blog/comments opted into search; llm-usage: `llmUsageResponseSchema` in @repo/schemas, BOTH apps' local interface sets deleted (web's llm dashboard had the same duplicate set), desktop fetch validated, recent-requests got search + model/source facets (equalsString), By Model/By Source searchable; server shape matched desktop interfaces exactly — no drift, no STOP; harness-verified filter→page-reset, facet, sort compose) |
| F6 | Overflow audit (kill the clipping traps) | S/M | DONE (2026-06-12: harness audit (clipped overflow with no descendant scroller) over 14 routes × 1280×800 + 700×500 with oversized fixtures; fixed: PaginatedDataTable root now `h-full` so its internal scroller engages in bounded wrappers (contacts/blog/comments were clipping rows), timetable page owns `overflow-y-auto` region (was relying on clipped shell, 543px unreachable), pomodoro content column scrolls at short heights; all combos re-audited clean; not covered for lack of fixtures: inbox/journal/kanban/calendar/whiteboard/resources/triage/sheet-editor — kanban/calendar/whiteboard are R4 per-page calls, rest folded into F7) |
| F7 | Issue discovery audit | S | DONE (2026-06-12: 22 routes swept; no new defects — see "F7 findings" section below for artifacts ruled out and coverage gaps) |
| R1 | Mobile navigation (doc §1 option B) | M | DONE (2026-06-13: `DashboardShell` mounts `SidebarProvider` + the formerly-dead `NavigationMenu` **gated on `useIsMobile()`** — stock shadcn renders its rail at md+ (`hidden md:block`), the inverse of option B, so gating mounts nothing ≥md (desktop pixel-identical) and the Sheet path serves <md; `DashboardPageHeader` wraps `@repo/ui` PageHeader and injects the `md:hidden` SidebarTrigger into the `leading` slot, keeping @repo/ui free of the user-settings-bound sidebar. 38 header copies → PageHeader across 25 files: a conservative codemod did the 29 regular icon+title+actions headers, manual for back-button `/new` pages (back button → `leading`), skeleton-only loading headers, and spreadsheets/editor error states. Genuinely-bespoke headers get the trigger injected into existing chrome instead of forced into PageHeader (would break layout): kanban board-switcher, resources detail-switcher, editor rename-title, notes/people Variant B `justify-between` toolbars (trigger placed **inside** the left cluster to keep 2 flex children — a sibling trigger would center the title <md), note-detail/person-detail, inbox overview, chat-view home+active toolbars, whiteboard canvas floating trigger. Verified via plan-005 puppeteer harness: 1280 no rail + trigger `display:none` + screenshot matches editorial baseline; 375 trigger→Sheet(15 GROUPS links)→nav on contacts/blog/projects/notes/people/blog-new/inbox. Gates: turbo typecheck + build (22 routes static) + biome check all green. **Finding (R3):** `/dashboard` chat home crashes in the browser harness on a pre-existing Tauri `'events'` dependency in its deps — HEAD chat-view crashes identically, so NOT an R1 regression; the other 6 routes run fine with DashboardShell, so it's chat-deps-specific. Chat-home trigger is code-verified (typecheck/lint) but browser-unverifiable until R3 makes the app browser-runnable. **Deferred to R4:** inbox split-pane sub-views (EmailList/EmailDetail) only get the trigger at the overview state; whiteboard canvas got a minimal floating trigger pending its R4 per-page call.) |
| R2 | `packages/ui` extraction (doc §4, DEBT-07) | L | DONE (2026-06-12: 34 shared files diff-adjudicated — desktop uniformly newer shadcn (radix-umbrella imports, border/input token rename, added variants), web carries INTENTIONAL divergences (motion tabs, next-themes sonner, mobile-fullscreen dialog, z-95/99 overlays, carousel nav hiding) — maintainer chose partial convergence: web swapped 24 skew-only files, keeps 10 local until R5; @repo/ui = 60 desktop-canonical components (incl. markdown-renderer/editor, PaginatedDataTable, skeleton-blocks) + new PageHeader (R1 trigger slot)/ResponsiveDialog/SortHeader (5 inline copies deduped) + use-mobile/use-textarea-editor hooks; excluded per plan: sidebar (user-settings), model-selector, markdown-pdf-renderer; zero @tauri-apps deps, @repo/ui:typecheck in turbo graph guards it; KEY LESSON: package peerDeps must pin the apps' exact react/react-dom/next versions or bun creates second store entries for peer-resolved libs (recharts dual-instance silently broke charts); verified on prod static export (F5 interactions PASS, F6 audit clean, chart renders); web build remains env-gated locally (needs full .env, pre-existing), web typecheck green) |
| R3 | Platform seam: browser-runnable desktop app (doc §6 #009) | M | DONE (2026-06-13: seam = lazy **adapter**, not literal injection — `lib/platform.ts` exports `isTauri()` (sync `"__TAURI_INTERNALS__" in window`, zero tauri import) + `platformFetch` (lazy-imports plugin-http only in Tauri, native fetch else); chosen over injection because `new denizApi()` is built in ~25 useMemo sites with no provably-first entry, so resolving per-call removes the ordering hazard. api-wrapper + update-checker route through it. **Chat-home `events` crash root-caused:** Tauri plugin-http streams the response body over Tauri's IPC channel — native fetch in-browser sidesteps it entirely; `/dashboard` now renders clean. Settings/pomodoro persistence via new `lib/platform-store.ts` (plugin-store in Tauri, `localStorage` blob `denizlg24:<file>` in browser) so the **API key persists in-browser** and the app can authenticate. `title-bar.tsx` effect guarded `if (!isTauri()) return` (kills F7's `platform()` page error); window controls left rendered-but-inert in browser. **Decision #2 (maintainer): action-time fs/dialogs got browser fallbacks now** — new `lib/platform-fs.ts` (`saveFile`→`<a download>`, `pickFile`→hidden file input, `pickDirectory`→Tauri-only/null); refactored 6 files (note-editor md+pdf export, email-detail attachment save, whiteboard-editor png export, spreadsheets import, pdf-viewer import, settings folder-pick gated to Tauri + locale → `navigator.language`); **Tauri paths preserved exactly** (dir-memory etc.). TS5.7 typed-array fix: `Uint8Array<ArrayBuffer>` in platform-fs (BlobPart rejects ArrayBufferLike). **Verify:** new no-mock harness `%TEMP%/p005-harness/r3-sweep.mjs` over 32 routes on `next dev :3001` — **ALL PASS, zero Tauri pageerrors**; probe confirms chat-home renders (input + suggestion chips) and native fetch hits the real `denizlg24.com/api/admin` (dashboard/stats, kanban/upcoming, conversations). Gates: turbo typecheck (both apps) + build --filter=desktop (33 routes static) + biome all green. **CORS note:** from localhost the browser hits prod cross-origin → requests fire but are CORS-blockable → caught as ApiError, NOT page errors; next dev didn't load the monorepo-root `.env` so the base URL fell back to prod. If live in-browser data is wanted later, a dev-only Next `rewrites()` proxy is the unblock (not built per "just run the dev server"). R4 can now use this harness for interactive testing. R6 (chat small-width polish) still separate.) |
| R4 | Responsive sweep of remaining pages (doc §2/§3/§5) | L | DONE (2026-06-13: mobile-first sweep across all dashboard routes. CSS column priority added to blog/comments/LLM usage/spreadsheets/triage; people + notes desktop toolbars become two-row mobile controls and people list keeps identity-only columns below `md`; settings rows stack; detail sheets are full-width below `sm`; inbox account rail is `md+` only with tested account→list→detail→back mobile flow and compact detail actions. Form calls migrated page-by-page to `ResponsiveDialog` on inbox compose/add-account, kanban create/edit, and spreadsheet create; destructive/detail dialogs intentionally remain dialogs. Per-page calls: **kanban** keeps horizontally scrollable columns (board semantics) but uses one-column mobile board/template pickers and removes the desktop-sidebar width cap; **calendar** uses a compact seven-column month grid with event dots below `md`, full event labels at `md+`; **whiteboard** uses one-column mobile board cards and a contained horizontally scrollable canvas toolbar. Triage category tabs and timetable chronology remain explicit horizontal scroll surfaces. Verification: all dashboard routes audited at 375×812, 768×1024, 1280×800 with no document overflow; drawer probes and inbox fixture interaction pass; full gates green.) |
| R5 | Web admin convergence on `@repo/ui` (doc §6 #011) | L | TODO |
| R6 | Chat-home polish at small widths (doc §6 #012) | S | TODO |

Sequencing: F1–F7 are bug/UX fixes and come first — they are the maintainer's
observed pain and they de-risk R2 (the components being extracted should be
extracted *fixed*, not broken). Within F-phases: F1, F2, F4 are parallel-safe
(disjoint files). F5 before F6 (filtering changes table layout; audit the
final layout). R-phases follow the doc's own sequencing: R1 self-contained
and first; R3 before/with R2; R4, R5 after R2; R6 anytime.

## Why this matters

`docs/responsive-admin-design.md` (plan 005 deliverable) established the
strategy: mobile-first dashboard styling, CSS column priority for tables,
ResponsiveDialog, `packages/ui` with desktop as canonical, platform seam for
browser-runnability. This plan executes it. Separately, the maintainer has
hit concrete defects in daily desktop use (graph double-render, broken
find-in-note scrolling, unfaithful skeletons, missing table filtering,
clipped overflow, weak LLM-usage page) — those are fixed first because they
touch the same components the extraction will canonicalize.

---

## Phase F1 — Note editor: find bar position + scroll-to-occurrence

**Symptoms (maintainer-reported):** the find bar renders at the absolute
bottom of the page content instead of sticking to the visible bottom of the
editor; "scroll to occurrence" does nothing.

**Root cause (verified in source — confirm at runtime before fixing):** both
symptoms share one cause. The shadcn `Textarea`
(`apps/desktop/components/ui/textarea.tsx:10`) applies `field-sizing-content
min-h-16`, so the textarea grows to fit its content rather than scrolling
internally. Consequences:

1. The editor column (`note-editor.tsx:560` → `relative flex-1 min-h-0 flex
   flex-col`) becomes content-height whenever an ancestor fails to constrain
   it, scrolling moves to an ancestor, and the `FindReplaceBar`
   (`note-editor.tsx:678`, rendered last in the column with `shrink-0`,
   `find-replace-bar.tsx:303`) lands at the bottom of the *content*, below
   the fold.
2. `selectMatch` (`find-replace-bar.tsx:142-159`) sets `textarea.scrollTop`
   — a no-op on an element that doesn't scroll.

There is a second, independent defect in `selectMatch`: the scroll target is
computed as `(lineNumber - 3) * lineHeight` from *newline-separated* lines —
soft-wrapped lines make this wrong even when the textarea does scroll, and
`parseInt(getComputedStyle(...).lineHeight)` is NaN→20 fallback when
line-height is `normal`.

**Steps:**

1. Reproduce: open a long note (taller than viewport), `⌘F`, type a query
   matching text far down. Confirm both symptoms and identify the actual
   scroll container in devtools (Tauri devtools or the R3 browser harness —
   the plan-005 puppeteer harness in `%TEMP%/p005-harness` works too).
2. Fix the height chain so the **textarea is the scroll container**: trace
   `note-detail.tsx` → `note-editor.tsx` ancestors for a missing
   `min-h-0`/`h-full`; ensure the editor's flex column is
   viewport-constrained. The textarea already carries `flex-1 min-h-0
   overflow-y-auto` (`note-editor.tsx:667`) — it just needs an ancestor that
   actually bounds it. If `field-sizing-content` still wins inside the
   bounded flex item, override it (`field-sizing: fixed` / a `field-sizing-`
   utility on this call site only — do NOT change the shared
   `textarea.tsx`, other consumers rely on auto-grow).
3. Fix scroll-to-occurrence accuracy: replace the newline-count heuristic
   with a mirror-div measurement (hidden div with identical font/width/
   padding/whitespace, content sliced to `match.start`, read its
   `scrollHeight`) — the editor already renders exactly such an overlay
   (`note-editor.tsx:563-564`); reuse it: locate the `<mark>` for the
   current match in the overlay and scroll the textarea to
   `mark.offsetTop - 3 * lineHeight`. Keep the existing overlay scrollTop
   sync (`onScroll`, `note-editor.tsx`) working in both directions.
4. Verify: find bar visible at the bottom edge of the editor pane regardless
   of note length, in both edit and preview toggle states; next/prev cycles
   scroll the current match into view (including matches inside one long
   soft-wrapped paragraph); replace and replace-all still work; multi-select
   highlight regions (`note-editor.tsx:572-584`) still render.

**STOP if** the height-chain fix requires changing `app/dashboard/layout.tsx`
or the shared `Textarea` defaults — those have app-wide blast radius;
report findings and confirm approach first.

## Phase F2 — Graph: double force explosion + notes/people alignment

**Symptoms:** opening the notes graph plays the force-layout "explosion"
twice; notes and people graphs have diverged in behavior (maintainer: notes
is the source of truth).

**Architecture (verified):** `NoteGraph` (38 lines) and `PersonGraph`
(36 lines) are thin prop-mapping wrappers over the shared
`components/graph/entity-graph.tsx` (210 lines), which builds nodes/links
and renders `components/graph/knowledge-graph.tsx` (322 lines) wrapping
`react-force-graph-2d`.

**Root-cause candidates (verify by instrumenting, then fix all that apply):**

1. `knowledge-graph.tsx:112-173`: a `useEffect([nodes, links])` polls via
   rAF until the ForceGraph ref accepts the custom collide/charge/link
   forces, then **unconditionally calls `d3ReheatSimulation()`** — the
   engine has already started its initial run with default forces by then,
   so the layout visibly runs twice (default explosion, then reheated
   explosion). Fix direction: configure forces before/at first engine start
   (e.g. set `cooldownTicks={0}`/`warmupTicks` until forces applied, or
   apply forces synchronously via ref callback on mount) so there is exactly
   one visible settle; only reheat on actual data change.
2. `entity-graph.tsx:60`: the node/link build is memoized, but the getter
   props (`getItemLabel`, `getItemGroupIds`, `getItemColor`) are passed as
   inline lambdas from both wrappers — if they are in the `useMemo` deps,
   every parent re-render rebuilds `nodes`/`links`, re-firing the reheat
   effect (and `graphData` identity churn at `knowledge-graph.tsx:110`).
   Check the actual dep array; fix by wrapping the getters in the wrappers
   with `useCallback`/module-level functions, or by keying the memo on
   `items/groups/edges` only.
3. React StrictMode double-mount in dev: confirm whether the double
   explosion reproduces in a production build before attributing to 1/2.
4. Divergence: with the shared pipeline, behavioral divergence lives in the
   **page-level composition** — diff the graph-data plumbing of
   `notes/page.tsx:570-585+869-883` (sortedNotes → `collectVisibleGroups` →
   graphGroups/graphEdges) against `people/page.tsx:399-413` and the two
   wrappers' val/color parameters. Align people to notes' behavior. If the
   shared plumbing is near-identical after the diff, extract a
   `useEntityGraphData(items, groups, edges)` helper next to `EntityGraph`
   so it cannot re-diverge.

**Verify:** graph opens with a single settle animation on notes AND people;
selecting nodes/groups still works on both; filtered views (search/sort)
update the graph without replaying the explosion; production build checked.

## Phase F3 — Skeleton fidelity sweep

**Symptom:** loading skeletons across the app don't match the layout they
are replaced by (content jumps on load).

18 files render skeletons (grep `Skeleton` under `apps/desktop/app/dashboard`
— blog, blog/comments, contacts, llm-usage, notes, now, people, projects,
resources/sub-resources, settings, spreadsheets ×2, timeline, triage ×3,
chat-view, dashboard-summary). The CLAUDE.md-designated exemplars are
`ContactsLoadingSkeleton` and `UsageLoadingSkeleton`.

**Steps:**

1. For each page: capture loaded layout, then its skeleton (throttle network
   or stub the API to delay), at 1280×800. Score: does the skeleton
   reproduce the page's structural blocks (header bar, stats strip, tab
   strip, table header + N rows, split panes) with correct heights so
   nothing shifts on swap?
2. Fix the unfaithful ones to be content-shaped, matching the final layout's
   real dimensions (`h-12` header, row heights, column count). Reuse one
   small set of skeleton helpers — these become `packages/ui` exports in R2,
   so put them in one file now (e.g. `components/ui/skeleton-blocks.tsx`):
   `HeaderBarSkeleton`, `StatStripSkeleton`, `TableSkeleton(rows, cols)`.
3. Keep per-page composition in the page (skeletons must mirror *that*
   page), but built from the shared blocks.

**Verify:** for each fixed page, loaded-vs-skeleton screenshots overlay with
no layout shift in the structural chrome (header/tabs/table position).

## Phase F4 — Upcoming tasks: port web presentation to desktop

**Symptom:** the web admin's upcoming-tasks UI
(`apps/web/app/admin/dashboard/_components/dashboard-overview.tsx`, 830
lines) is better than desktop's
(`apps/desktop/app/dashboard/_components/dashboard-summary.tsx`, 372 lines,
`ScheduleTasksSwitcher` tasks tab) — but its shape must be re-fitted to the
desktop's minimalist/editorial design, not copied.

**Facts:** both apps hit the same endpoint (`kanban/upcoming?days=7`) and
both hand-declare identical `UpcomingCard`/`UpcomingBoardGroup`/
`UpcomingKanbanResult` interfaces — a direct violation of the
`@repo/schemas` contract rule, in both apps.

**Steps:**

1. Add `upcoming-kanban` zod schemas to `packages/schemas`
   (`UpcomingCard`, `UpcomingBoardGroup`, `UpcomingKanbanResult`); delete
   both local interface sets; `turbo typecheck` to surface breakage (per
   CLAUDE.md: schemas first).
2. Port the web presentation's *content model* into
   `dashboard-summary.tsx`: stats summary (total / overdue / due today /
   due this week), board-grouped cards with column title and due label
   (`overdue` / `today` / `tomorrow` / `in Nd` — web's wording), overdue
   emphasis. Keep desktop conventions: `text-xs`/`text-sm`, muted
   foreground, `tabular-nums`, badge variants, NO framer-motion (web uses
   `motion.div`; desktop does not take that dependency).
3. Keep the existing Schedule/Tasks tab switcher behavior
   (`dashboard-summary.tsx:138-156`) — only the tasks tab body changes.

**Verify:** desktop dashboard renders the richer tasks panel with fixture
data covering: empty, only-overdue, >3 boards (current code slices to 3 —
decide and document whether that cap stays); typecheck green in both apps.

## Phase F5 — Shared table filtering + LLM usage page upgrade

**Symptom:** desktop tables have sorting but no filtering; the LLM-usage
page additionally "is poor — lacks filtering and sorting" (its tables do
sort via `SortHeader`, but nothing is filterable and the page has no
controls beyond the period tabs).

**Facts (verified):**
- `components/ui/paginated-data-table.tsx` (263 lines) wires
  `getCoreRowModel` + `getSortedRowModel` + `getPaginationRowModel` only —
  no `getFilteredRowModel`, no toolbar (lines 90-103).
- `llm-usage/page.tsx` declares local wire interfaces (`UsageStats`,
  `ModelBreakdown`, `SourceBreakdown`, `DailyBreakdown`, `RecentRequest`,
  `UsageResponse`, lines 20-72) and calls `GET llm/usage` unvalidated —
  the schema sweep backlog item; fold its desktop side in here.
- Period switching is client-side over a pre-fetched all-periods payload
  (`data[period]`, line 409) — fine, keep it.
- `SortHeader` is copy-pasted in 5 pages (blog, blog/comments, contacts,
  llm-usage, spreadsheets) — known; full dedup happens in R2, do not move
  files now.

**Steps:**

1. Extend `paginated-data-table.tsx` (additive, like the plan-005
   `meta.className` change): add `getFilteredRowModel`, optional
   `globalFilter` + `columnFilters` state, and an opt-in toolbar slot —
   a search `Input` (global filter) and optional per-column faceted filters
   (shadcn `Select`/`Combobox` over distinct column values). Zero behavior
   change for pages that don't opt in.
2. Opt in the consumer pages where filtering earns its place: contacts
   (already has status tabs — add text search over name/email/message),
   blog (search title/tags), comments (search author/content), llm-usage.
3. LLM usage page: add `LlmUsageResponse` schema to `packages/schemas` and
   validate the fetch; add filter controls to the recent-requests tab —
   text search + model and source selects (facet values from the breakdown
   data already in the payload); make By Model / By Source tables
   globally searchable; keep period tabs as-is.
4. Check the web app's admin LLM page (if it consumes the same endpoint)
   compiles against the new schema.

**Verify:** filtering + sorting + pagination compose correctly (filter
resets to page 1, sort survives filter); existing pages without the toolbar
render pixel-identical; typecheck green in both apps.

**STOP if** the `llm/usage` response shape in `apps/web` disagrees with what
the desktop interfaces assumed — reconcile in the schema first, report the
drift, don't paper over it on the client.

## Phase F6 — Overflow audit

**Symptom:** the desktop app forces `overflow-hidden` at the shell, which
*hides* real overflow instead of exposing it; content becomes unreachable
(the design doc calls this "worse than scroll", §Cross-cutting).

**Facts:** `app/layout.tsx:30,32` (`h-screen overflow-hidden` on html AND
body) and `app/dashboard/layout.tsx:9-10` (`overflow-hidden` on main and
the content wrapper).

**Policy decision (made here, executor applies):** the shell stays
non-scrolling — that is correct for a desktop app frame (no rubber-band
document scroll behind a fixed TitleBar). The fix is not "remove
overflow-hidden", it is: **every page must own an explicit scroll region**
(`overflow-y-auto` + `min-h-0` chain) so nothing relies on the clipped
shell. The bugs are the pages that don't.

**Steps:**

1. Inventory: for each `app/dashboard/*` route, render with oversized
   fixture content and find clipped-but-unreachable regions (the plan-005
   harness measures `scrollWidth`/`scrollHeight` > container — reuse it,
   extended to vertical).
2. Fix per page: give the overflowing region `overflow-y-auto min-h-0`
   (most pages already follow the pattern — llm-usage does it correctly at
   `page.tsx:412-418`; copy that shape).
3. Known suspects from F1/F4 work: notes detail/editor chain, dashboard
   summary at short window heights, settings, triage settings. Verify each.
4. Re-check at the Tauri minimum: the window has no `minWidth` (doc §5) —
   test at ~700×500 as the worst plausible desktop size, not just 1280×800.

**Verify:** no route has content that is clipped with no scroll affordance
at 1280×800 and at 700×500.

## Phase F7 — Issue discovery audit

The maintainer flagged "there may be more issues". Timebox: one session.

1. Sweep every dashboard route with the harness (fixtures where needed):
   console errors, clipped content (F6 leftovers), skeleton mismatch (F3
   leftovers), dead interactions (buttons that no-op without an obvious
   reason).
2. File findings as a list appended to this plan (or `plans/README.md`
   backlog if out of scope) — do NOT fix in this phase; fixes land in the
   relevant phase or as follow-ups. Known backlog items (kanban rollback
   BUG-03, listeners BUG-06, bundle PERF-04) stay in the backlog — do not
   re-report them.

### F7 findings (2026-06-12, one-session timebox)

Swept all 22 dashboard routes at 1280×800 with fixtures (or empty states
where no fixture exists), collecting page errors, console errors, text
snapshots and screenshots:

- **No new defects found.** Two initial hits were harness artifacts: the
  fixture id generator produced colliding 24-char ids (`pr1`/`pr10` pad to
  the same string → React duplicate-key warning), and whiteboard's console
  error was the app correctly logging the mock's 404.
- Known, already-tracked: `platform()` TypeError on every route outside
  Tauri (R3 fixes it); kanban/calendar/whiteboard layout calls deferred to
  R4 (per plan).
- Coverage gaps, not defects: inbox/journal/kanban/calendar/whiteboard/
  resources/triage were swept in empty/error states only (no fixtures for
  their endpoints yet), and dead-interaction testing (buttons that no-op)
  was not systematically scripted — both can ride along when R3's browser
  harness makes interactive testing cheap.

## Phase R1 — Mobile navigation (doc §1, option B)

Implement exactly the doc's recommendation:

- Mount `SidebarProvider` + the existing (currently dead-code)
  `NavigationMenu` in `app/dashboard/layout.tsx`.
- Sidebar hidden ≥ `md:`; below `md:` it is reachable via the stock
  mobile Sheet behavior plus a `SidebarTrigger` hamburger in each page's
  header bar (this is the seed of the `PageHeader` component — if R2 hasn't
  landed yet, add the trigger via a small shared header component now and
  promote it in R2).
- Desktop (≥ `md:`) UX unchanged: ⌘K palette remains the nav; `GROUPS` in
  `navigation-menu.tsx` remains the single source of truth for both.
- Whether desktop *also* shows a sidebar is explicitly deferred (maintainer
  decision, per doc) — do not add it.

**Verify:** at 375px every route in `GROUPS` is reachable by touch alone;
at 1280px the app is pixel-identical to before (no sidebar, no trigger).

## Phase R2 — `packages/ui` extraction (doc §4)

- Diff-adjudicate the 28 shared-but-divergent `components/ui` files
  (desktop canonical; expect mostly shadcn version skew, eyeball each).
- Create `packages/ui` (`@repo/ui`) — scaffold-first per repo rules, deps
  via `bun add`: all ~59 desktop primitives, shared `DataTable`/`SortHeader`
  (dedup the 5 inline copies — F5's filtering lands in the shared one),
  `PaginatedDataTable`, `PageHeader` (h-12 border-b icon+title+actions +
  R1's trigger slot), `ResponsiveDialog` (Dialog ≥ `md:`, vaul Drawer below,
  built on `useIsMobile` — doc §3), `markdown-renderer`/`markdown-editor`,
  F3's skeleton blocks.
- Excluded (doc): `components/window/*`, `model-selector`,
  `markdown-pdf-renderer`, anything importing `api-wrapper`/`user-settings`.
  Package declares zero `@tauri-apps/*` deps; CI typecheck guards it.
- Both apps consume `@repo/ui`; delete the local copies they replace.

**STOP if** diff adjudication finds a pair where the *web* copy carries a
real behavioral fix the desktop copy lacks — list them for maintainer call
instead of silently picking desktop.

## Phase R3 — Platform seam (doc §6 #009)

- `lib/api-wrapper.ts`: accept an injected `fetch` (Tauri plugin-http in
  the desktop entry, native elsewhere).
- `lib/user-settings.ts`: injected store backend (plugin-store vs
  localStorage).
- Feature-detect Tauri in `title-bar.tsx` (kills the `platform()`
  TypeError, doc §Cross-cutting) and the other `components/window/*`.
- Outcome gate: `next dev` on apps/desktop runs in a plain browser with no
  page errors — this becomes the test harness for R4/F-phase verification.

## Phase R4 — Responsive sweep of remaining pages (doc §2/§3/§5)

Per the doc's policies — mobile-first base styles usable at 375px, `md:`
restores density, `lg:` pixel-equivalent to today; CSS column priority via
`meta.className` (mechanism already in `paginated-data-table.tsx`); detail
sheets `w-full sm:max-w-md`; form dialogs migrate to `ResponsiveDialog`
page-by-page. Contacts is done (plan 005 prototype). Big-ticket items the
doc singles out: **inbox split-pane → stacked list→detail below `md:`**;
llm-usage recent-requests hides Input/Output below `md:`; kanban, calendar,
whiteboard each get a per-page call (document the call in the commit).

## Phase R5 — Web admin convergence (doc §6 #011)

Rebuild `apps/web/app/admin` pages on `@repo/ui` and the editorial design
language, mobile-first. Web keeps its own auth/data layer (better-auth
session; pages re-composed, not imported from desktop — doc §4). F4 will
already have converged the dashboard-overview content model; this phase
restyles the rest.

## Phase R6 — Chat-home polish (doc §6 #012)

Suggestion-chip overflow at 375px (wrap or horizontal scroll-with-affordance),
chat-history panel width on small viewports, plus any `overflow-hidden`
clipping traps F6/F7 deferred as chat-specific.

---

## Verification gates (every phase)

```
bunx turbo typecheck && bunx turbo build --filter=desktop
bun run format-and-lint
```

plus the phase's own visual verification. Phases touching `packages/schemas`
also run `bunx turbo typecheck` with no filter (both apps). UI phases verify
at 1280×800 AND 375×812 once R1+ has landed (before that, 1280×800 + 700×500
per F6).

## Out of scope

- Backend changes beyond adding schemas for existing payloads (the
  backend schema sweep stays a backlog item; F4/F5 only add the two
  payload schemas they touch).
- Kanban bug-fixes (BUG-03/06), triage prompt hardening (SEC-04) — backlog.
- Desktop sidebar-on-desktop UX change — explicitly deferred maintainer
  decision (doc §1).
