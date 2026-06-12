# Responsive admin design + shared UI direction

Deliverable of plan 005 (design spike, 2026-06-12). Audited at `apps/desktop`
on the plan-005 branch; evidence gathered by running `next dev` in a plain
Chrome instance driven by puppeteer, with `window.__TAURI_INTERNALS__.invoke`
mocked (store returns a dummy API key, http plugin returns fixture JSON), at
375×812, 768×1024 and 1280×800. This required zero code changes — the harness
lives outside the repo (`%TEMP%/p005-harness`).

A correction to the audit premise up front: **the sidebar is dead code.**
`components/navigation/navigation-menu.tsx` exports a complete shadcn-sidebar
`NavigationMenu`, but nothing mounts it. The dashboard shell is
`TitleBar` + `CommandPalette` only; all navigation is keyboard-driven (⌘K)
plus the settings-defined default-page redirect. The app is not merely
desktop-only — it is *keyboard-only*. Everything below starts from that fact.

## Current breakage inventory

Method note: pages were rendered with fixture data for `contacts` and
`llm/usage`; `inbox` and the chat home rendered their empty states (their
chrome is what matters at small widths). "Inner overflow" = the document does
not scroll horizontally (the app shell is `overflow-hidden`), but a child
scroll region is wider than the viewport.

### `/dashboard` (chat home)

- **375px**: Mostly survives. Clock, prompt input and suggestion text centre
  correctly. Suggestion chips overflow their flex row by ~30px (392/408px
  content in a 375px viewport) — clipped, not scrollable. The chat-history
  sidebar toggle (hamburger) renders but opens a desktop-width panel.
- **768px**: fine.
- **Works already**: single-column composition; no table, no split pane.

### `/dashboard/contacts`

- **375px**: Header bar content is 452px wide in a 375px viewport — the
  Refresh action gets clipped off-screen. Stats strip (5 `Total/Pending/…`
  blocks) wraps into two ragged rows. The status tab strip is 436px wide —
  the "Archived" tab is clipped and unreachable (no scroll affordance). The
  table renders 1089px wide inside an inner horizontal scroll region: only
  Ticket/Name/~half of Email are visible; Message, Status, Date and the
  row-actions menu require blind horizontal scrolling.
- **768px**: table still 1089px — same inner overflow, slightly less severe.
- **1280px**: clean; this is the editorial baseline to preserve.

### `/dashboard/inbox`

- **375px**: The fixed two-pane split (account list + reading pane) renders
  both panes side by side at ~224px + ~273px (497px total, clipped). The
  "Sync All" action is cut off. Unusable; this page needs a stacked
  list→detail navigation below `md:`, not column squeezing.
- **768px**: panes fit but the reading pane is cramped; acceptable.

### `/dashboard/llm-usage`

- **375px**: Degrades surprisingly well: period tabs fit, stat blocks wrap
  2-up tidily, the recharts area chart resizes correctly. Only the
  recent-requests table overflows (558px, inner scroll) — Input/Output token
  columns push Cost/Date off-screen.
- **768px / 1280px**: fine.

### Cross-cutting

- **TitleBar**: renders fake minimize/maximize/close window controls in a
  browser; on every page load `title-bar.tsx:60-63` calls `platform()` from
  `@tauri-apps/plugin-os` with no feature detection → uncaught
  `TypeError: Cannot read properties of undefined (reading 'platform')` in
  non-Tauri environments. Non-fatal (async effect) but it is the canary for
  "no browser story".
- **Navigation**: ⌘K palette is the only nav. No touch path to any page.
- **Hover/keyboard affordances**: row-action `⋯` dropdown menus and the
  palette are usable on touch, but keyboard shortcuts (⌘K) have no touch
  equivalent.
- **No horizontal body scroll anywhere** — the `overflow-hidden` shell means
  breakage shows up as clipped/unreachable content, which is worse than
  scroll: there is no way to reach it at all.

### Tauri coupling inventory (grep evidence)

`grep -rln "@tauri-apps" apps/desktop/app/dashboard apps/desktop/components apps/desktop/lib apps/desktop/context apps/desktop/hooks`:

| File | What it uses | Severity for shared UI |
|------|--------------|------------------------|
| `lib/api-wrapper.ts` | `@tauri-apps/plugin-http` `fetch` at module load | **Critical** — every page's data layer imports this |
| `lib/user-settings.ts` | `@tauri-apps/plugin-store` (dynamic import) | Critical — gates every page via `UserSettingsProvider`; redirects to `/` when no key |
| `lib/utils.ts` | `@tauri-apps/plugin-shell` `open` (dynamic import) | Low — single helper, already lazily imported |
| `lib/update-checker.ts` | `plugin-http` at module load | None — desktop-only by nature |
| `components/window/title-bar.tsx` | `plugin-os`, window controls | None — desktop-only shell, but needs feature detection |
| `components/window/disable-context-menu.tsx`, `update-notifier.tsx` | window/process plugins | None — desktop-only shell |
| `app/dashboard/settings/page.tsx` | `plugin-os` `locale` | Low |
| `app/dashboard/inbox/_components/email-detail.tsx` | (attachment download / shell open) | Medium |
| `app/dashboard/notes/_components/note-editor.tsx` | fs/dialog plugins | Medium |
| `app/dashboard/spreadsheets/page.tsx` | fs/dialog plugins | Medium |
| `app/dashboard/whiteboard/_components/whiteboard-editor.tsx`, `templates/pdf-viewer.tsx` | fs/dialog plugins | Medium |

Notably **not** coupled: all of `components/ui/*`, `components/markdown/*`
(except the `@react-pdf` renderer's weight), the nav GROUPS data, all
skeletons, and most page components — their only Tauri dependency is
transitive through `api-wrapper`/`user-settings`.

## 1. Navigation

Findings: the shadcn `components/ui/sidebar.tsx` already ships full mobile
support (`useIsMobile()` < 768px → renders as a `Sheet`), and
`navigation-menu.tsx` already builds a complete grouped menu from its
exported `GROUPS` data — but the component is never mounted, so none of that
runs. The command palette consumes the same `GROUPS` array, which is the
right single source of truth.

Options considered:

- **A. Mount the sidebar everywhere** (one-line-ish change in the dashboard
  layout): desktop gets a persistent/collapsible sidebar, mobile gets the
  built-in Sheet for free. Rejected *for now*: it deliberately changes the
  desktop UX the maintainer likes (chromeless, palette-driven), which this
  spike is forbidden to do.
- **B. Mobile-only nav affordance**: below `md:`, page header bars gain a
  hamburger `SidebarTrigger`; the sidebar renders only via its mobile Sheet
  path (`<Sidebar collapsible="offcanvas">` stays closed/hidden ≥ `md:`).
  Desktop keeps the palette untouched. Reuses `GROUPS`, `sidebar.tsx`,
  and `NavigationMenu` as-is.

**Recommendation:** Option B. Mount `SidebarProvider` + the existing
`NavigationMenu` in `app/dashboard/layout.tsx` with the sidebar hidden at
`md:` and above, exposing it on small viewports through the stock Sheet
behavior plus a `SidebarTrigger` in each page's header bar. The palette stays
the desktop path; `GROUPS` stays the single nav source. (Whether desktop
should *also* get a visible sidebar is a separate maintainer decision —
revisit after the mobile nav exists.)

## 2. Data tables

The contacts table is the worked example: 6 columns (Ticket, Name, Email,
Message, Status, Date) + actions = 1089px natural width. Options:

- **Horizontal scroll** (status quo): rejected as the primary treatment —
  it hides Status, Date and the actions menu, i.e. exactly the columns an
  on-phone triage pass needs.
- **Card-list fallback**: a parallel non-table rendering per page. Rejected
  for the spike: doubles the rendering code per page and abandons the
  editorial table aesthetic; worth reconsidering page-by-page later only if
  column priority proves insufficient.
- **CSS column priority** (`hidden md:table-cell` / `lg:table-cell` on both
  `<TableHead>` and `<TableCell>`): table semantics, sorting and the
  TanStack column model stay untouched; no JS resize listeners; all data
  remains reachable through the existing row → detail-sheet interaction.

**Recommendation:** CSS column priority, decided per page. Every row must
keep its identity column, its status, and its row action at 375px; columns
hidden on mobile must be visible in the row's detail surface. Contacts:
375px shows Name, Status, Date (+ actions); `md:` adds Ticket and Email;
`lg:` adds Message. LLM-usage recent-requests: hide Input/Output tokens
below `md:` (Cost and Date matter more). Inbox is not a table problem —
its split pane should stack into list→detail navigation below `md:`
(follow-up plan). TanStack still mounts hidden cells; acceptable at these
row counts (≤50/page), revisit only if a page paginates by hundreds.

## 3. Dialogs / sheets

Inventory: 24 files use `Dialog` (forms: compose email, kanban card,
timetable entry, add-account, create-resource…); 7 use `Sheet`
(contact/blog/project/timeline/triage detail editors); `drawer.tsx` (vaul)
exists but has **zero** consumers.

- Detail **Sheets** already work at 375px: shadcn's `SheetContent` defaults
  to `w-3/4 sm:max-w-sm`; the contacts sheet (`sm:max-w-md`) just needs
  full-width below `sm:` to avoid a cramped 281px column.
- Form **Dialogs** at 375px center a near-full-screen modal with the
  keyboard covering half of it; the platform-native pattern is a bottom
  drawer.

**Recommendation:** introduce one `ResponsiveDialog` wrapper (Dialog ≥ `md:`,
vaul Drawer below — same API surface, built on the existing `useIsMobile`)
in the future `packages/ui`, then migrate form dialogs to it page-by-page
during the responsive sweep; do not hand-convert 24 call sites before the
wrapper exists. Detail sheets stay sheets, with `w-full sm:max-w-md`-style
widths. (The contacts prototype applies exactly this sheet fix; it has no
Dialog usages.)

## 4. Shared UI package shape

Hard data on DEBT-07: desktop has 59 `components/ui/*` files, web has 38.
Of the 34 shared filenames, only 6 are byte-identical (`card`, `chart`,
`command`, `empty`, `kbd`, `skeleton`), 28 differ, and 25 are desktop-only.
The two copies HAVE diverged; the extraction plan must diff and adjudicate
each of the 28 (most diffs are likely shadcn version skew, but each needs
eyes). **Desktop is the canonical copy** — it is newer, more complete, and
carries the design language being adopted.

`packages/ui` (future, `@repo/ui`) should contain:

- All ~59 shadcn primitives from desktop after diff adjudication — none of
  them import Tauri (verified by grep).
- `PaginatedDataTable` + a shared `DataTable`/`SortHeader` (currently
  copy-pasted inline in 5 pages: blog, blog/comments, contacts, llm-usage,
  spreadsheets).
- A `PageHeader` component encoding the `h-12 border-b` icon+title+actions
  bar (now that it needs responsive behavior — hamburger slot, action
  collapse — it has earned componenthood; today it is a copy-pasted div).
- `markdown-renderer.tsx` / `markdown-editor.tsx` (pure React; their katex
  weight is acceptable). **Not** `markdown-pdf-renderer.tsx`
  (`@react-pdf/renderer` stays in the desktop app).
- Content-shaped skeleton helpers.
- Explicitly excluded: `components/window/*`, `model-selector` (chat/API
  coupled), anything importing `lib/api-wrapper` or `lib/user-settings`.

Tauri isolation: `packages/ui`'s `package.json` simply never declares any
`@tauri-apps/*` dependency, and CI typecheck/lint guards regressions. The
data layer stays out of the package entirely — components receive data via
props. The seam that actually needs building is in the *apps*:
`api-wrapper` should accept an injected `fetch` (Tauri's in the desktop app,
native elsewhere) and `user-settings` an injected store backend — that is a
small `@repo/platform`-style follow-up, and it is also what makes the
desktop app runnable in a plain browser for development and testing.

Whole pages vs. design language for the web admin: pages themselves are thin
(state + `denizApi` calls + composition), and the web admin's auth model
(better-auth session vs Bearer key) and routing differ. Porting whole page
files would drag the desktop data layer along.

**Recommendation:** `packages/ui` = primitives + shared composites
(DataTable/SortHeader, PageHeader, ResponsiveDialog, markdown, skeletons),
zero Tauri imports, desktop's copies as canonical after a per-file diff
adjudication. The web admin adopts the *package and the design language* and
re-composes its own pages; it does not import desktop page components.

## 5. Breakpoint policy

The Tauri window ships 1280×720 with **no `minWidth`** — users can already
shrink the desktop app into the broken zone, so responsiveness pays off
inside Tauri too, not just on a future phone/web admin.

**Recommendation:** desktop-first styling in the dashboard is dead. All
dashboard pages use mobile-first Tailwind: the base (unprefixed) styles must
produce a usable single-column layout at 375px; `md:` (768px) restores
multi-pane/multi-column density; `lg:` (1024px+) is the full editorial
desktop layout, which must remain pixel-equivalent to today's design.
No new `max-*:` variants; no JS viewport branching except the existing
`useIsMobile` where a component must swap primitives (Sheet/Drawer).

## 6. Follow-up plan list

| # | Plan | Effort |
|---|------|--------|
| 007 | Mobile navigation: mount `SidebarProvider`/`NavigationMenu` per §1 option B, `SidebarTrigger` in `PageHeader`, touch path to every route | M |
| 008 | `packages/ui` extraction: DEBT-07 diff adjudication, move primitives + DataTable/SortHeader/PageHeader/ResponsiveDialog/markdown/skeletons, both apps consume `@repo/ui` | L |
| 009 | Platform seam: injected fetch in `api-wrapper`, injected store in `user-settings`, feature-detect Tauri in `TitleBar`/window components — desktop app becomes browser-runnable (kills the `platform()` pageerror) | M |
| 010 | Responsive sweep of remaining dashboard pages per §2/§3 policy (inbox split-pane → stacked list/detail is the big one; kanban/calendar/whiteboard each need a per-page call) | L |
| 011 | Web admin convergence: rebuild `apps/web/app/admin` pages on `@repo/ui` + the editorial design language, mobile-first | L |
| 012 | Suggestion-chip + chat-home polish at small widths; audit remaining `overflow-hidden` clipping traps | S |

Sequencing: 009 before or with 008 (the package is more testable once the
apps run in a browser); 010 and 011 after 008; 007 can go first — it is
self-contained.

## Appendix: contacts prototype verification

Prototype scope: `app/dashboard/contacts/page.tsx` +
`_components/contact-detail-sheet.tsx` only. Desktop (≥1280px) rendering
unchanged by design.

| Width | Result |
|-------|--------|
| 375px | _filled in by the prototype step_ |
| 768px | _filled in by the prototype step_ |
| 1280px | _filled in by the prototype step_ |

(Measured with the same puppeteer harness. The "1 Issue" pill visible in raw
screenshots is the Console Ninja dev overlay, not the app.)

Observation recorded for the backlog, outside this spike's scope:
`llm-usage/page.tsx` defines local wire interfaces (`UsageResponse` etc.)
and calls `GET` without a zod schema — contrary to the `@repo/schemas`
contract rule. Fold into the backend schema sweep backlog item.
