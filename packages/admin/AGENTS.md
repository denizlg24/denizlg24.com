# packages/admin — admin UI shared by web and desktop

Every admin feature (contacts, finance, workspace, study, …) is a component
here. The hosts only mount it:

- web: `apps/web/app/admin/dashboard/*` wraps it in `AdminFeatureShell`.
- desktop: `apps/desktop/app/dashboard/*` builds the provider value with
  `useDesktopAdmin()` (an admin client bearing the OAuth session's token, the
  Tauri platform bridge, the sidebar trigger slot) and renders the feature's
  exported skeleton while settings load.

The context (`provider.tsx`) carries `client`, `platform`, `routes` and
`slots`. Wire types are `@repo/schemas` (`z.infer`); change the schema first
and let `turbo typecheck` surface both hosts. Never reintroduce local wire
types.

## Routing

- **Paths come from `routes.*` on the context, never from props.** The
  interface and the `withQuery` / `withSegments` helpers are `src/routes.ts`;
  each host maps it once (`apps/web/lib/admin-routes.ts`,
  `apps/desktop/lib/admin-routes.ts`), so a host that forgets a route fails to
  typecheck.
- **Desktop is a static export.** It addresses a record with `?id=` where web
  uses a segment, wraps detail routes in `AdminRecordRoute` /
  `AdminQueryRoute` (`apps/desktop/components/admin-route.tsx`), and needs
  every route in `KNOWN_ROUTES` (`apps/desktop/context/user-context.tsx`) or
  it renders not-found.
- A new routed surface: an `AdminRoutes` entry, both host maps, a real
  directory in each app, and the desktop `KNOWN_ROUTES` entry.

## UI

- **Built from `@repo/ui`'s page system** — read `packages/ui/DESIGN.md`
  before adding a page, dialog or list. Editorial: small text, muted
  secondary info, `tabular-nums` for numbers, hairlines over bordered cards.
- **No sheets for content.** Use a wide dialog (body scrolls, max height) or
  a route; only confirms stay compact. Genuine overlays beside what they act
  on (the agent launcher, the papers reading sheet, markets order tickets)
  are the exception.
- **Loading is a content-shaped skeleton** exported next to the page
  (`ContactsSkeleton` in `contacts/contacts-page.tsx`).
- **React Compiler is on in both hosts, so render-time reads of mutable
  module state are memoized on their inputs.** `cache.get(ref)` in a hook body
  is cached on `ref` and never re-read when the cache fills; that left record
  cards and widgets on skeletons for good. Read external caches through
  `useSyncExternalStore` with the data itself as the snapshot (`useRecord`,
  `useSource`), or keep the state in a zustand store.

## Workspace

The admin is a Notion-style workspace. Server-side rules (ops, revisions,
rebase, markdown, views, templates, triggers, themes, surfaces) are in
`apps/web/AGENTS.md`.

- `workspace/modules.ts` is the one registry of modules (sidebar sections,
  ⌘P search, default-page options). `workspace/sidebar.tsx` shows favorites,
  the page tree and the modules; `workspace/sidebar-trigger.tsx` is every
  page header's leading slot, visible only while the sidebar is collapsed or
  in its mobile sheet. Module labels, icons and order come from appearance
  through `useWorkspaceNav()` — list sections from the nav, not
  `MODULE_SECTIONS`.
- **Pages are documents.** `/dashboard` is Home and `/dashboard/page?id=`
  any other; `workspace/page-view.tsx` renders a page as one TipTap editor
  (`editor/`), a flow of nested blocks with `columns` for layout and live
  widgets (`blocks.tsx`) as atoms. A new block type means a `blockSchema`
  entry in `@repo/schemas` `workspace`, a `block-catalog.ts` entry (also the
  "/" menu), a `createBlock` case, a case in `editor/doc.ts` if it is not an
  atom, and a renderer (`blocks.tsx` for widgets, else
  `editor/node-views.tsx`).
- **`workspace/store.ts` is the client store for both hosts.** Desktop's
  `workspace.json` is a read cache for an instant launch, never a source of
  truth. Live blocks share fetches through `use-workspace-data.ts`.
