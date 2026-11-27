# Dashboard for iPhone

The `/admin/dashboard` cockpit as a native app (`com.denizlg24.dashboard`).
Owner-only and unpublished, installed from the Mac like Hours. Design:
`docs/internal/plans/029-native-dashboard-ios.md` — what is in scope, what is
deliberately left on web and desktop, and why.

The phone reads state, decides and captures. Anything that is a keyboard and
big-screen job is not here; Hours, Voice and Location have their own apps.

## Stack

Expo SDK 57: expo-router (`src/app`) with five native tabs, each its own
stack (Today · Inbox · Calendar · Money · More), formSheets for decisions,
TanStack Query, `@expo/ui` SwiftUI controls, SF Symbols. UI primitives are
`@repo/native-ui`: hairlines and typography, never cards; errors inline,
never toasts. Email HTML is the only `WKWebView`.

The theme is `packages/ui/src/theme.css`: native-ui's colours are its light
and dark pairs (`DynamicColorIOS`), body text is Inter and display sizes are
Calistoga, embedded at build by `expo-font` from `@repo/native-ui/fonts`.
Anything that cannot take a dynamic colour (navigation themes, headers) reads
`useResolvedColors()`. Widgets carry the same background and label colours.

Today combines the daily overview with the desktop workspace: a live clock, then Events / Tasks /
Alerts, desktop workspace Home/favorites (recently edited pages when there are
no page favorites), then resources and LLM spend. More → Pages browses and
searches the same workspace page tree as desktop, excluding trash and templates.
Pages are native documents: text, nested lists, checklists, toggles, tables,
images, linked record summaries and live view queries; desktop columns stack
vertically. Record summaries are deduplicated and fetched in batches using the
shared API limit. Full editing,
custom components and workflow execution open the page in the system browser.
New pages/subpages and append-only text capture use formSheets. Checklist and
capture writes send revision-aware `workspace/pages/:id/ops`, never replace a
whole document from the phone cache. Locked pages stay read-only on the phone.
A composer pinned to the bottom of a screen sits in `KeyboardDock`, which
keeps it above the home indicator and the keyboard; scroll views use
`automaticallyAdjustKeyboardInsets`.

Every response is typed with `@repo/schemas` — no local response interfaces,
or `turbo typecheck` stops catching contract drift. Pure maths and formatting
are `@repo/utils`; the agent's UI message stream is reduced by
`@repo/utils/agent-stream`, shared with Voice.

## Sign-in

`@repo/native-auth` on the "iPhone apps" native client with the redirect
`com.denizlg24.dashboard:/oauth/callback`. The session JSON lives in the App
Group keychain (`group.com.denizlg24.dashboard`) so widgets, App Intents and
the Share extension call the API with it (`Shared/Session.swift`).

## Native

`modules/dashboard-native`: session, installation id, the Today and watchlist
snapshots the widgets draw from (`SnapshotStore`), and Spotlight (titles,
one line and a deep link — never bodies). `targets/widgets` is the WidgetKit
extension; `ios/Intents` is compiled into both the app and the extension.
`withSceneLifecycle` is applied: the iOS 27 SDK refuses to launch without it.

## Run

```
bun run prebuild       # after app.config.ts or plugin changes
bun run ios            # simulator
bun run ios:device     # Release build on the phone
```

`EXPO_PUBLIC_DASHBOARD_SITE` points a build at another web origin.
Expo modules compile from source (`usePrecompiledModules: false`): the default
precompiled views crashed in `ExpoViewProps` during native initialization with
this app's React Native build. Regenerate iOS after changing that setting.

## Checks

```
bun run typecheck && bun test
```

## Server side and sign-in

Design: `docs/internal/plans/029-native-dashboard-ios.md`; the app's
`AGENTS.md` has the detail. The `/admin/dashboard` PWA install surface is
gone (no manifest, no home-screen metadata); the page itself stays.

- **Sign-in is the "iPhone apps" native client** with a third redirect,
  `com.denizlg24.dashboard:/oauth/callback` — a hand row on
  `auth_oauth_client.redirect_uris`, like Location's.
- **Today mirrors the desktop's dashboard home**: a live clock, then
  Events / Tasks / Alerts (agenda and alerts from `GET /api/admin/dashboard/today`,
  tasks from `/kanban/upcoming`), then resources and LLM spend. The whiteboard
  lives under More → Board. `dashboard/today` (`lib/dashboard-today.ts`) still
  carries counts, budget and board todos because the widgets draw its App
  Group snapshot; each source fails open, and widgets never refetch quotes.
- **The query cache survives a launch** (`src/lib/query.ts`, a JSON file in
  the app's cache directory), so tabs paint the last answer before the network
  returns. Email bodies, authenticator codes, board renders and agent threads
  are never written; sign-out deletes the file.
- **Pushes are filtered on the server.** iOS shows an alert before app code
  runs, so `MobileDevice.notifications` holds the phone's toggles and
  `notifyDashboard` (`lib/mobile-push.ts`) skips devices with a kind off. The
  kind table is `@repo/schemas` `dashboard-notifications`. Send on a
  transition into a state, never on every re-evaluation; the collapse id is
  per (kind, subject). Lock-screen text is sender, subject or a headline —
  never a body, an amount or a code.
- **Three ways in.** Web call sites call `scheduleDashboardPush`; the cloud
  API's `MobileNotifier` and the status page post to `/api/mobile/notify`
  (bearer `MOBILE_NOTIFY_TOKEN`, equal on api and web, or status's service
  token). Cloud notification types map through `CLOUD_NOTIFICATION_KINDS`;
  migration 0054 added `forge_deploy_failed`, `auth_sign_in` and
  `auth_credential_changed`.
- **The morning brief is `/api/jobs/morning-brief`**, idempotent per day via
  `AppSettings.morningBriefSentOn`. Nothing in this repo calls it: point the
  external scheduler at it at the hour it should arrive.
- **Chat YOLO is per conversation**, off whenever a thread opens. Approvals
  are answered against the stored conversation, never the streamed copy
  (`@repo/utils/agent-stream`).
- **The authenticator shows server-computed codes.** No code path to
  `/authenticator/export` exists in the app.
