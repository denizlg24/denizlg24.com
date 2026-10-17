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

Today is the desktop's dashboard home: a live clock, then Events / Tasks /
Alerts, then resources and LLM spend — nothing another tab already owns.
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

## Checks

```
bun run typecheck && bun test
```
