# Hours for iPhone

The `/admin/hours` PWA as a native app (`com.denizlg24.hours`), for one user.
Single-user copy rules apply: no explanatory text, terse surfaces. Not
published: `bun run ios:device` installs a Release build signed with a
development profile through the Xcode account (automatic provisioning; the
App Store Connect key is refused by Xcode for this). CI
(`personal-ios.yml`) only builds it unsigned.

## Stack

Expo SDK 57 like Macros: expo-router (`src/app`), native tabs (Clock,
History, Pay), formSheets, TanStack Query, `@expo/ui` SwiftUI pickers,
SF Symbols (`expo-symbols`). UI primitives are a trimmed copy of Macros'
(`src/ui`): hairlines and typography, never cards; errors inline, never
toasts. Contracts are `@repo/schemas` work-hours; pure maths is `@repo/utils`.

## Sign-in

`@repo/native-auth`: authorization code + PKCE against deniz auth through
ASWebAuthenticationSession, redirect `com.denizlg24.hours:/oauth/callback`,
client id from `GET /api/public/mobile-auth` (`MOBILE_OAUTH_CLIENT_ID` on
web, the "iPhone apps" native client). The session JSON lives in the App
Group keychain (`group.com.denizlg24.hours`) because the widget extension and
App Intents call the API themselves (`Session.swift` refreshes on its own).
Both sides re-read storage before refreshing.

## Native

- `modules/hours-native` — the Expo module (pod `HoursNative`). `Shared/` is
  compiled three times: into the pod, into the widget extension, and (through
  `import HoursNative`) used by the App Intents in the app target. `Intents/`
  is compiled into the app and the extension, never the pod.
  `@repo/expo-ios-targets` does the target wiring (`plugins/with-hours-targets.js`).
- JS hands every fresh `/hours` payload to `HoursNative.setOverview`; Swift
  derives the snapshot (`Overview.snapshot`, mirroring `shiftActivityState` in
  `@repo/utils`), stores it in the App Group, syncs the Live Activity and
  reloads widgets and controls.
- Live Activity (`ShiftAttributes`, lock screen + Dynamic Island) with Break /
  Resume / Check out as `LiveActivityIntent`s, which run in the app process —
  the only one ActivityKit lets change an activity. Started locally on
  clock-in; the server pushes start / update / end for changes made anywhere
  else (`apps/web/lib/mobile-push.ts`). `DeviceRegistrar` reports the
  push-to-start and per-activity tokens to `PUT /api/admin/mobile/devices/:id`.
  Requests carry `x-mobile-installation` so the server never push-starts a
  duplicate on the phone that clocked in.
- Widgets: Shift (small, medium, three Lock Screen sizes, interactive
  buttons) and Week (target, month, next payout). Running figures are `Text`
  timers anchored at `workedFrom`, so nothing reloads every minute.
- Control Center / Action Button: `ShiftControl` toggle, `ToggleShiftIntent`;
  Siri phrases in `targets/app/HoursShortcuts.swift`.
- Reminders (`features/reminders`): dated one-offs re-planned on every
  overview change — still checked in, break due, break over (time-sensitive),
  week target, payday. Notification buttons clock directly.

## Checks

```
bun run typecheck && bun test
bunx expo prebuild --platform ios --clean
xcodebuild -workspace ios/Hours.xcworkspace -scheme Hours -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

An unsigned simulator build has no entitlements, so keychain and App Group
calls fail there (expo-notifications logs `ERR_NOTIFICATIONS_KEYCHAIN_ACCESS`);
`bun run ios` signs for the simulator and works.
