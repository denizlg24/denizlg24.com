# Plan 012: Extract admin UI into a shared `@repo/admin` package

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report — do not improvise.
> When done, update the status row in `plans/README.md`.

## Status

- **Priority**: P2
- **Effort**: XL (multi-feature migration; sequenced, not big-bang code)
- **Risk**: MED-HIGH (touches every admin feature in both apps)
- **Depends on**: 003 (monorepo), 004 (`@repo/schemas`), 007 (`packages/ui`)
- **Category**: architecture / DX
- **Planned at**: `HEAD` = 373d518, 2026-06-26
- **Current**: IN PROGRESS (checkpoint 2026-06-26c: blog, calendar, inbox,
  projects, and timeline now migrated to `@repo/admin` and wired into both apps
  via thin route wrappers. The app-specific "New" deep link is injected as a
  `newHref` prop (keeps shared components route-agnostic without touching the
  provider); inbox attachment download routes through `PlatformBridge`
  (`saveFile`→`downloadFile`) and the sidebar trigger through the `slots`
  seam. Notes is now migrated with a scoped shared surface: folder-grid view,
  note detail/editor, note/group create/update/delete, tags/groups/status
  metadata, deep-linked note selection, and markdown download through
  `PlatformBridge`. The web route intentionally excludes PDF export, graph
  view, semantic panel/local classifier, and AI enhance controls. Dead
  app-local `_components` removed in both apps, plus web's now-dead
  `[id]/edit`, `blogs/[id]`, and `inbox/account/[id]` route trees (edit happens
  in-sheet; comments are global). `bunx turbo typecheck` + both production
  builds are green (`bun --env-file=.env turbo build --filter=web` supplies
  `MONGODB_URI` from the repo root); `biome check` clean. Earlier checkpoint:
  foundation/adapters plus resources, contacts, now-page, llm-usage, timetable,
  and authenticator. Still outstanding: desktop-only journal/kanban/
  people/pomodoro/spreadsheets/triage/whiteboard/settings, web-only api-tokens/
  comments/instagram-tokens, and the final hover sweep.)

## Maintainer-confirmed decisions (2026-06-26)

Settled via planning Q&A — do not re-litigate:

1. **Sharing model = injected `AdminClient` adapter.** Feature components are
   fully shared, client-side, and never fetch directly. They call an injected
   `AdminClient` interface. Each app supplies one adapter.
2. **Package = new `@repo/admin`.** `@repo/ui` stays pure primitives;
   `@repo/admin` holds data-aware feature components and depends on `@repo/ui`
   + `@repo/schemas` + `@repo/utils`.
3. **Scope = all admin features** (commitment: no stopping after a pilot).
   Build order still goes foundation → reference feature → replicate.
4. **Canonical UI = desktop's.** The desktop versions are preferred; web adopts
   them. Web admin pages become thin `"use client"` wrappers that mount the
   shared component with the web adapter.
5. **Resources redesign = tabbed sections** (Overview / Sub-resources /
   Capabilities) so capabilities and sub-resources are clearly separated and
   readable. Keep the minimalist/editorial styling.

## Asserted implementation defaults (advisor; flag before code if wrong)

- **Error model: adapters throw, components catch.** `AdminClient` methods
  return `Promise<T>` and **throw `AdminApiError { message, code }`** on
  failure. The desktop adapter normalizes `denizApi`'s `T | AuthError | ApiError`
  union into a throw; the web adapter throws on non-2xx. Components use
  `try/catch` + `sonner` toast. (Cleaner than threading the union through shared
  components; the `"code" in result` pattern stays an adapter-internal detail.)
- **Second injected interface: `PlatformBridge`** for platform-only capability
  (clipboard, file save/open dialogs, notifications, "download/export"). Desktop
  impl = Tauri plugins; web impl = browser APIs (anchor download, Notification
  API, `navigator.clipboard`). Features that have no web analogue degrade
  gracefully, not crash.
- **Components are route-agnostic.** Prefer in-page master/detail + tabs (matches
  the desktop pattern and the Resources decision). Where deep links are needed
  (e.g. blogs/projects edit pages), inject a `routes`/`Link` helper rather than
  hardcoding `/admin/dashboard/...` vs `/dashboard/...`.
- **App shell stays app-specific.** Sidebar, Tauri title bar, auth, and routing
  live in each app. Only feature page *bodies* move to `@repo/admin`.
- **Hover→always-visible fix** is applied to every reveal-on-hover **action
  control** (`opacity-0 group-hover:opacity-100`, `hidden`→`group-hover:*`) as
  each component is ported; a final sweep covers anything not migrated. Plain
  `hover:bg`/`hover:text` styling on already-visible controls is left as-is.
- **Provider: `AdminProvider`** (React context) supplies `{ client, platform,
  routes }` to the shared tree, so feature components read them via
  `useAdmin()` instead of prop-drilling.

## Why this matters

`@repo/ui` already shares primitives, but feature-level admin UI is duplicated
across `apps/web/app/admin/dashboard/**` and `apps/desktop/app/dashboard/**`,
and the two have **diverged** (different layouts, different data plumbing). The
only hard reason they diverged is the data layer:

| | Web (current) | Desktop (current) |
|---|---|---|
| Render | RSC, async server components | all `"use client"` |
| Data | direct Mongo (`Model.find().lean()`) | `denizApi` (Tauri HTTP) → `/api/admin` |
| Auth | better-auth session cookie | Bearer token (`settings.apiKey`) |
| Mutations | server actions / API routes | `denizApi` |

Key enabler: `apps/web/lib/require-admin.ts` `requireAdmin`/`getAdminSession`
already accept **either** a Bearer token **or** the session cookie. So web can
consume its own `/api/admin/*` from the browser with `credentials: "include"`
and **no auth change**. That makes the injected-adapter model viable with the
desktop UI becoming canonical for both apps.

## Feature inventory (asymmetric — share common, host single-app)

- **Common (both apps)**: resources, contacts, blog(s), calendar, inbox,
  llm-usage, notes, now/now-page, projects, timeline, timetable, authenticator.
- **Desktop-only**: journal, kanban, people, pomodoro, spreadsheets, triage,
  whiteboard, settings.
- **Web-only**: api-tokens, comments, instagram-tokens.

Single-app features still move into `@repo/admin` (they benefit from the shared
client + primitives); they just have one app wiring them.

## Architecture

```
packages/admin/
  package.json            # exports "./*": "./src/*.tsx" (mirror @repo/ui, no build step)
  src/
    client.ts             # AdminClient interface, AdminApiError, namespaced sub-APIs
    platform.ts           # PlatformBridge interface
    provider.tsx          # AdminProvider + useAdmin()
    resources/            # reference feature (page + tabs + sections)
    contacts/  blog/  ... # one dir per feature
```

```
apps/desktop/lib/admin-client.ts   # AdminClient impl over denizApi
apps/desktop/lib/platform-bridge.ts# PlatformBridge over Tauri plugins
apps/web/lib/admin-client.ts       # AdminClient impl over fetch(/api/admin, credentials:include)
apps/web/lib/platform-bridge.ts    # PlatformBridge over browser APIs
```

Each app's route file becomes a thin wrapper:

```tsx
// apps/desktop/app/dashboard/resources/page.tsx
"use client";
export default function Page() {
  return <AdminProvider value={desktopAdmin}><ResourcesPage/></AdminProvider>;
}
```

## Build order

1. **Scaffold `@repo/admin`** — package.json (deps: `@repo/ui`,
   `@repo/schemas`, `@repo/utils`; peer react/react-dom/next), tsconfig
   mirroring `@repo/ui`. Add `"@repo/admin": "workspace:*"` to both apps.
   Gate: `bunx turbo typecheck` green (empty package).
2. **Define interfaces** — `AdminClient` (namespaced: `client.resources.*`,
   `client.contacts.*`, …), `AdminApiError`, `PlatformBridge`, `AdminProvider`,
   `useAdmin()`.
3. **Implement adapters** in both apps (desktop over `denizApi`, web over
   `fetch`). Start with only the `resources` slice of each.
4. **Reference feature — Resources**:
   - Port desktop `resources/_components/*` into `@repo/admin/resources/`.
   - Redesign detail into tabs: **Overview** (url/desc/metrics/uptime/node +
     reboot/services), **Sub-resources** (the `sub-resources-section` content,
     with at-a-glance status), **Capabilities** (the `capability-section` +
     picron drill-in). Each tab owns its space.
   - Apply hover→always-visible to capability/sub-resource row controls.
   - Wire desktop + web pages to the shared component via their adapters.
   - Gate: `bunx turbo typecheck`; `turbo build --filter=web` and
     `--filter=desktop`; manual smoke in both. STOP and report before step 5.
5. **Replicate** for remaining common features, then desktop-only, then
   web-only. One feature per commit; typecheck + both builds green each time.
6. **Final hover sweep** + delete now-dead app-local `_components`.

## STOP conditions

- Step 4 reveals an `/api/admin/*` route that does NOT accept the session cookie
  (browser 401/403 from web adapter) → report; do not weaken auth unilaterally.
- A feature needs a capability with no clean web analogue and no graceful
  degradation → report the feature + capability, propose options.
- Web build regresses because a ported component imports a server-only module
  (mongoose/node) transitively → report; the shared package must stay
  client-safe.
- Any change to a `@repo/schemas` contract is required → that is plan 004's
  domain; propose the schema change separately first.

## Verification

- `bunx turbo typecheck` (both apps + packages) green.
- `bunx turbo build --filter=web` and `--filter=desktop` green.
- `bun run format-and-lint` clean.
- Manual: each ported feature renders + performs one mutation in BOTH apps;
  action controls visible without hover (check at 375px).
