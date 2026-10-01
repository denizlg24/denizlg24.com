# Macros for iPhone and Android

The native client for Macros, and its only client: an iOS app first, plus a
sideloaded Android APK built from the same code. `apps/macros` (Next.js) is
the backend plus a marketing site; there is no web app. This app talks to its
`/api/*` routes and nothing else, except the `/register/*` pages that
verification and password-reset emails open.

## Stack

- Expo SDK 57, React Native 0.86 (New Architecture only), React 19.2, Hermes.
- expo-router with `src/app` as the route root. Native tabs
  (`expo-router/unstable-native-tabs`), native stacks, form sheets.
- TanStack Query, persisted per user to AsyncStorage.
- Better Auth through `@better-auth/expo`: the session cookie lives in
  SecureStore and every request carries it in a `Cookie` header.
- `@expo/ui` for SwiftUI-backed controls: `@expo/ui/community/segmented-control`,
  `@expo/ui/community/datetime-picker`, `@expo/ui/community/menu`,
  `@expo/ui/community/picker`, `@expo/ui/community/slider`, and
  `@expo/ui/swift-ui` (`Host`, `ContextMenu`, `Chart`, `Gauge`, …). On
  Android the community components render Jetpack Compose; `swift-ui` has
  no Android side at all.
- `react-native-svg` for charts that need more than Swift Charts' single series.
- `expo-camera` (barcodes, label photos), `expo-image-picker`,
  `expo-image-manipulator`, `expo-haptics`, `expo-image`, `expo-sharing`,
  `expo-file-system`, `expo-crypto`.
- `lucide-react-native` for icons, the web app's set. `@resvg/resvg-js`
  (dev only) renders them to PNGs for native chrome.

- `expo-notifications`: local reminders in every build, APNs registration
  only when `capabilities.push`. Every reminder (log, weigh-in, each habit)
  is a dated one-off laid out by `planReminders` over at most 14 days within
  iOS's 64-request cap — never a repeating trigger, which cannot skip a day
  already done. `NotificationsSync` re-plans on launch, foreground, log
  changes and every dashboard update (weigh-ins, habit ticks), and a tapped
  reminder opens its screen.
- `modules/macros-health`: our own Swift Expo module over HealthKit
  (`@modules/macros-health`). Null outside a native build; gate on
  `healthAvailable()` from `features/health/sync.ts`.

Nothing else is installed. Do not add dependencies without a reason that
survives review.

## Layout

```
src/app/                 routes only — thin files that render a feature screen
  _layout.tsx            auth gate: (auth) | onboarding | (app) via Stack.Protected
  (auth)/                sign in, sign up, verify email, forgot password
  onboarding/            the registration wizard
  (app)/_layout.tsx      stack: the tabs plus every modal/sheet route
  (app)/(tabs)/          NativeTabs: (today), log, progress, more, and the "+"
  (app)/add-food/        the add-food hub: its own stack inside a modal
src/features/<feature>/  screens, feature components, feature-only hooks
src/features/<feature>/routes.ts   the feature's modal routes (see below)
src/api/<domain>.ts      TanStack Query hooks per API domain
src/components/          nutrition pieces shared across features
src/ui/                  design-system primitives (import from "@/ui")
src/lib/                 api client, auth client, query client, dates, format
scripts/                 release tooling for the SideStore source (bun, not RN)
```

## Contracts

Every request and response type comes from `@repo/schemas/macros` — never
declare a wire type locally. Response types are `z.infer` (output); request
bodies with defaults are typed `z.input<typeof schema>` on the client. If a
route's shape is missing, add it to `packages/schemas/src/macros` first and
make the route `satisfies` it. Pure domain logic (nutrient definitions,
serving display, unit conversions, WHO guidelines, wizard maths, weight
trend, serving-amount scaling) is `@repo/macros-core/*` — shared with the
web app, never copied. The food-icon catalogue is `src/api/food-icons.ts`.

## Data

- `api<T>(path, { method, body, query, formData, signal })` in `lib/api.ts`
  throws `ApiError` (status, message, zod issues) or `NetworkError`. A 401
  signs the device out through the gate. `apiVoid` is for 204 routes.
- Query keys start with their domain (`["food-log", …]`, `["foods", …]`) so a
  domain invalidates by prefix. After anything that changes what was eaten,
  call `invalidateAfterLogging`; after weigh-ins, `invalidateAfterWeighIn`
  (`src/api/keys.ts`).
- Log writes (`useLogFood`, `useQuickAdd`, `useLogRecipe`, `useLogMealTemplate`,
  `useUpsertWeighIn`, `useSetHabitCompletion`) are offline-safe: they run by
  mutation key with defaults registered in `lib/query-client.ts`, are
  persisted while paused, and (for food) carry a `clientMutationId` the server
  de-duplicates on. Logging in a basement gym is a normal case. A new
  offline-safe write needs all three: a standalone mutation function, a
  registered default, and the key stamped into the variables before queueing
  (a key minted inside the function changes on every replay).
- A write the server refuses after its screen has gone goes to
  `recordFailedWrite` (`lib/failed-writes.ts`), keyed by its idempotency key so
  the default and the screen reporting the same failure make one notice.
  `FailedWritesNotice` renders the list, with Retry where the writer supplied
  one; Today, Log and Add food show it. Hook-level `onError` overrides the
  registered default, so a live failure is handled in place and only replays
  reach the list unless the screen reports them itself.
- The food log is time-based, never meal-based. Entries are placed and grouped
  by `eatenAt` (hour sections in the log; a date + time "Eaten" row wherever
  food is logged); the app never shows or sends breakfast/lunch/dinner/snack.
  We don't know our users' meals. No request body accepts a meal; the server
  derives its internal `mealType` bucket from `eatenAt`. Copy, duplicate, move
  and saved-meal logging each take the time in one request — never patch
  entries one by one after the fact.
- Anything loaded at runtime (food icons, the icon catalogue, photos) holds its
  final size with a `Skeleton` (`src/ui/skeleton.tsx`) until it arrives, so
  nothing shifts or pops in.
- "Today" is the profile's timezone (`useProfile().data.timezone`), via
  `useToday(timezone)` from `lib/day.ts`, which rolls over at midnight and on
  foreground.
- Units: the server stores kg and kcal. Display with `lib/format.ts`
  (`formatWeight(kg, profile.weightUnit)`, `formatEnergy(kcal,
  profile.energyUnit)`), convert input back with `kgFromUnit`.

## Native iOS, not a web page in a shell

iOS is the design target and its code paths stay as they are; Android gets
fallbacks. Where a component diverges, a `name.android.tsx` sits beside
`name.tsx` and types itself as `typeof import("./name")`'s export, so Metro
picks it on Android and `tsc` still checks it against the iOS signature;
small differences are a `Platform.OS` check. The ones that exist:

- `@/ui/date-time-picker`, `@/ui/segmented-control`, `@/ui/slider`,
  `@/ui/stepper`: import these, never `@expo/ui` directly. Android's
  community date picker opens a dialog the moment it mounts, and Compose
  controls otherwise take the wallpaper's Material You colours. The
  community picker only sizes itself vertically, so in a row it stretches
  and centres; a trailing time pill is `CompactTimePicker` from the same
  wrapper.
- `toolbarText({...})` from `@/ui/toolbar` for every text-only
  `Stack.Toolbar.Button`: Android silently drops a toolbar button without an
  image, so Save and Cancel vanish. It is a call, not a component, because
  the toolbar reads its children's element types. A bottom toolbar becomes a
  floating Material toolbar over the content on Android; screens with one
  pad by `useBottomToolbarInset()`.
- `showActionSheet` / `confirmDestructive` and `promptText`
  (`features/more/shared`) — ActionSheetIOS and `Alert.prompt` do not exist
  on Android; `AndroidDialogHost` (root layout) draws both. `Link.Menu` is
  iOS only, so a row that relies on it adds an Android `onLongPress` into
  `showActionSheet`. `Stack.Toolbar.SearchBarSlot` renders nothing there;
  the search field lives in the header.
- `colors` in `ui/theme.ts` reads `@color/macros_*` resources on Android,
  written by `plugins/with-android-colors.js` with iOS's own values (light
  and night). A new colour needs an entry in both. Android resolves a
  resource once per view, so the root navigator remounts on a dark-mode
  switch.
- Keyboard: an edge-to-edge Android window no longer shrinks for the
  keyboard, and the `keyboardWill*` events are iOS only. `Screen` with
  `automaticallyAdjustKeyboardInsets` handles it; anything else uses
  `useAndroidKeyboardHeight` or the `keyboardDid*` events.
- iOS-only surfaces hide on Android: the Apple Health section (HealthKit
  and the Shortcuts import). Copy that names the device uses `DEVICE_NAME`.

- A tab's root screen hides the native bar (`tabRootOptions`) and draws its
  own `PageHeader`: the large title with the screen's actions
  (`HeaderIconButton`, `HeaderTextButton`, an `@expo/ui` `MenuView`) on the
  same row, inside a `Screen statusBarScrim`. A native large title leaves an
  empty bar above it, which on a root is dead space. Pushed pages keep the
  native header (back button, `Stack.Toolbar` buttons and menus). A bottom
  `Stack.Toolbar` does not render under a hidden bar, so a root's modes
  (Log's selection) put their actions in the `PageHeader` row too.
- Icons are Lucide. In content, `<Icon name>` from `@/ui` (the registry is
  `ui/icons.ts`; add a name there first). Native chrome (the tab bar,
  toolbar buttons and their menus) takes images, not components: pass
  `glyphs.<name>` from `@/ui/glyphs` with `iconRenderingMode="template"`, or
  the bar draws it black. Those PNGs are generated: add the name to
  `scripts/render-glyphs.ts` and run `bun scripts/render-glyphs.ts`. Only
  `Link.MenuAction` and `@expo/ui` menus are left on SF Symbols — they accept
  nothing else, and Android shows those menus without icons.
- Taps never act twice. `installNavigationGuard` (root layout) drops a second
  navigation within 400 ms, so no sheet opens twice and no close pops two
  screens; calls in the same tick (close, then open) count as one. `Button`
  drops a repeat press within 600 ms, and a handler that writes without a
  `Button` (a toolbar Save) wraps itself in `useSinglePress`. The row "+"
  that stages food is the one deliberate exception: tapping it twice adds
  twice.
- Short tasks are sheets, not pages: `compactSheet` (fits content) or
  `detentSheet` (0.6 → 1) from `features/shell/routes.ts`. A sheet without a
  navigation bar opens with `SheetHeader` from `@/ui` (title, artwork,
  actions, Close) and pads its content by `sheetGutter` with `spacing.xl`
  above the header; edit sheets with Cancel / Save use the log's bar. Full forms with
  Cancel/Save are `formModal`. Camera surfaces are `cameraModal`. A modal
  route is registered by adding it to the feature's `routes.ts` array — the
  presentation must be known before the screen is pushed.
- Sheets handle the keyboard natively. Numeric input uses
  `keyboardType="decimal-pad"` and `parseDecimal` (accepts a comma), except a
  food amount, which is `AmountBar`'s keypad.
- A formSheet that holds a ScrollView takes at most two subviews: the
  ScrollView and one sibling with `collapsable={false}`. A header drawn as a
  flattened sibling lands *under* the scroll content, which then swallows its
  taps — the edit-entry sheet's Cancel/Save did nothing until the header moved
  inside the ScrollView (`stickyHeaderIndices={[0]}`).
- The log's rows: swipe left for Delete / Duplicate; drag right to pick the
  row up, then up or down to move it through its day in 15-minute steps
  (`features/log/retime*.ts`). It saves through `queueEntryUpdate`, so the
  row lands at its new hour at once and the write survives being offline.
- Adding food follows the web app's model. The tab bar's middle "+" (a
  disabled trigger, so it never selects) opens the shortcuts sheet; Search
  opens the add-food hub: a time chip and a calorie pill in the header, a
  Scan / Search / Recipes / Library / Shop strip with the plate bar under it
  (sticky), and the search field alone in the bottom toolbar. A row's "+"
  stages its amount on the plate; everything on it is logged together. Swipe
  logs at once. The plate bar (`PlateBar`: count, energy, macros, Log) is in
  content, not a toolbar, because iOS collapses the other toolbar items while
  the search field is active; `PendingPlateBar` shows the same on Today and
  the Log whenever the plate holds food.
  The food and recipe sheets dock `AmountBar` at the bottom: the amount, a
  secondary action and the primary one; tapping the amount opens our own
  keypad (fractions and mixed numbers, `features/add-food/amount-input.ts`)
  with the units above it, and scrolling the sheet closes it. Add / Update
  stage on the plate; opened from anywhere but the hub (a scan, My foods, New
  food) they land in the hub afterwards (`goToHub`), and a scanned food opens
  in the same sheet over the hub. Log Foods stages the food and logs the whole
  plate at once, then closes the sheet and the hub (`leaveAfterLogging`).
  Editing a staged item swaps them for Remove / Update.
- Lists: swipe actions via `SwipeRow`, long-press context menus, pull to
  refresh through `Screen onRefresh`. Search uses the native search bar
  (`headerSearchBarOptions`).
- Pickers are native: segmented controls, date pickers and menus from
  `@expo/ui/community/*` (through the `@/ui` wrappers above where one
  exists). No hand-rolled dropdowns.
- Haptics (`lib/haptics.ts`): `success` when a write lands (`goalReached` if a
  log first crosses the day's calorie or protein target), `error` when one is
  refused, `warning` on an undoable delete and `selection` on its undo and on
  every picker/toggle, `light` staging on the plate, `impact` on a swipe or
  barcode read. `Screen` (refresh), `SwipeRow` and `useDeferredCommit` fire
  their own; don't repeat them at call sites.
- Respect Dynamic Type: no fixed heights on text containers.
- Icon-only buttons get an `accessibilityLabel`.

## Look

Editorial and monochrome, like the web app. Typography and hairline rules
carry the hierarchy (`Section` = uppercase label + hairline); no cards, no
bordered boxes, no chunky progress bars (`Meter` is 3 pt). The tint is the
label colour; the macro hues (`macroColors`) are the only colour. Figures use
`Text figure` (SF Pro Rounded, tabular). Chrome colours are PlatformColors
(`colors` in `ui/theme.ts`) so dark mode and Increase Contrast work without
branching; SVG needs concrete values from `useResolvedColors()`.

## Feedback

No toasts, ever — a toast covers the row that was just touched. Success is
self-evident (a row appears, a count moves) plus a `Flash` on the place it
happened and a success haptic. Errors are an `InlineNotice` inside the
surface that raised them, somewhere that cannot scroll away. A destructive
action is undoable in place where practical.

## Copy

Macros is multi-user (the one exception to the monorepo's single-user copy
rules). Onboarding copy, plain-language labels and empty states that say what
belongs there are expected here — but keep them short.

## Checks

```
bun run typecheck          # app + scripts
bun test                   # pure logic and release tooling
bunx expo export --platform ios --output-dir dist   # Metro bundle (Hermes)
bunx expo export --platform android --output-dir dist
bunx expo prebuild --platform ios --no-install      # native project generation
bunx expo prebuild --platform android --no-install
```

`android/` is generated like `ios/` and never committed (`bun run
prebuild:android`, `bun run android` for an emulator; both need a JDK 17 and
the Android SDK).

Biome runs from the repo root (`bunx biome check --write apps/macros-mobile`).
Never cast to `any`/`unknown` to silence a type error.

`tsconfig.json` sets `types: []` and excludes tests: app code runs on Hermes
and must not typecheck against Bun's globals (`Bun.file`, Bun's `FormData`).
Tests (`*.test.ts`, pure modules only — nothing that imports react-native) are
checked by `tsconfig.test.json` with Bun's types. Files the camera or picker
produced are uploaded with `expo-file-system`'s `File#upload`, not `FormData`;
a request that bypasses `api()` but carries the session calls
`reportUnauthorized()` on a 401.

## Release

`.github/workflows/macros-mobile.yml` does everything. Its build jobs run on
every PR and push, reference no secret, and must pass: `build-ios` (the
unsigned SideStore IPA, refused if it carries any entitlement),
`build-ios-adhoc` (`MACROS_IOS_DISTRIBUTION=adhoc` compiled unsigned for a
device, its generated entitlements checked against the ad-hoc allowlist with
`scripts/adhoc-entitlements.ts --unsigned`) and `build-android` (a release
APK with the embedded bundle, debug-signed). The release jobs run in the
`macros-release` environment, which needs the owner's approval, and every
signing secret lives there as an environment secret — never a repository
one, or the ungated build jobs could read it.

When `version` in `package.json` changes on `main`, `release-ios-sidestore`
publishes the built IPA as `macros-ios-v<version>` and regenerates the
SideStore source (`scripts/compose-source.ts`) on the rolling
`macros-ios-source` release. SideStore re-signs the IPA with the user's
Apple ID, which is why that build has no entitlements: a free account cannot
grant push, App Groups, HealthKit or associated domains. Bump `version` for
every release — SideStore detects updates by version alone.

Entitled features exist only in the ad-hoc build (`MACROS_IOS_DISTRIBUTION=adhoc`),
signed by the paid team in `release-ios-adhoc`, which runs on the same
version change and when the server dispatches the workflow with
`adhoc: true` after the owner approves a device — so a device approval also
needs a GitHub environment approval before it ships. `lib/config.ts`
`capabilities` says which build is running; UI for HealthKit and remote push
hides behind it. `plugins/without-entitlements.js` strips the
`aps-environment` expo-notifications writes into every build. To exercise
the ad-hoc build locally without a paid team, prebuild with the flag and run
it in the simulator, which needs no provisioning.

`release-android` takes the APK `build-android` produced, re-signs it with
the release key (`zipalign`, then `apksigner`, refusing the debug
certificate) and publishes `macros-android-v<version>` (`--latest=false`),
which `https://macros.denizlg24.com/android/Macros.apk` streams. `versionCode` is
the workflow run number (`MACROS_ANDROID_VERSION_CODE`); Android refuses an
update signed with a different key, so the keystore behind the
`MACROS_ANDROID_*` secrets can never change. `plugins/with-android-signing.js`
still signs at prebuild when all four variables are set, for a local release
build; CI never passes them. Every release job whose secrets are missing
exits green with a notice.

Android has no HealthKit and no FCM: `capabilities` is false for both there, and reminders
are local notifications on the `reminders` channel, scheduled inexactly
(no exact-alarm permission). Health Connect and FCM push are not built.

HealthKit sync runs on foreground (at most every 10 minutes) and after log
changes: it posts weight, body fat, steps and active energy to
`/api/health-sync` (the Shortcuts import, under the session) and writes one
sample per nutrient per day back, keyed by an HK sync identifier so a higher
version replaces the day's previous total.
