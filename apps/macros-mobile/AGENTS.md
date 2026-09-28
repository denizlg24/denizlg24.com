# Macros for iPhone

The native iOS client for Macros, and its only client. `apps/macros` (Next.js)
is the backend plus a marketing site; there is no web app. This app talks to its
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
  `@expo/ui/swift-ui` (`Host`, `ContextMenu`, `Chart`, `Gauge`, …).
- `react-native-svg` for charts that need more than Swift Charts' single series.
- `expo-camera` (barcodes, label photos), `expo-image-picker`,
  `expo-image-manipulator`, `expo-haptics`, `expo-image`, `expo-sharing`,
  `expo-file-system`, `expo-crypto`.
- `lucide-react-native` for icons, the web app's set. `@resvg/resvg-js`
  (dev only) renders them to PNGs for native chrome.

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

- Every tab screen is a `Screen` (a ScrollView with automatic content insets)
  under a large title that collapses on scroll. Header buttons and menus are
  `Stack.Toolbar` / `Stack.Toolbar.Menu` / `Stack.Toolbar.MenuAction`,
  declared inside the screen via `<Stack.Screen options>` or
  `<Stack.Toolbar placement="right">`.
- Icons are Lucide. In content, `<Icon name>` from `@/ui` (the registry is
  `ui/icons.ts`; add a name there first). Native chrome (the tab bar,
  toolbar buttons and their menus) takes images, not components: pass
  `glyphs.<name>` from `@/ui/glyphs` with `iconRenderingMode="template"`, or
  the bar draws it black. Those PNGs are generated: add the name to
  `scripts/render-glyphs.ts` and run `bun scripts/render-glyphs.ts`. Only
  `Link.MenuAction` and `@expo/ui` menus are left on SF Symbols — they accept
  nothing else.
- Taps never act twice. `installNavigationGuard` (root layout) drops a second
  navigation within 400 ms, so no sheet opens twice and no close pops two
  screens; calls in the same tick (close, then open) count as one. `Button`
  drops a repeat press within 600 ms, and a handler that writes without a
  `Button` (a toolbar Save) wraps itself in `useSinglePress`. The row "+"
  that stages food is the one deliberate exception: tapping it twice adds
  twice.
- Short tasks are sheets, not pages: `compactSheet` (fits content) or
  `detentSheet` (0.6 → 1) from `features/shell/routes.ts`. Full forms with
  Cancel/Save are `formModal`. Camera surfaces are `cameraModal`. A modal
  route is registered by adding it to the feature's `routes.ts` array — the
  presentation must be known before the screen is pushed.
- Sheets handle the keyboard natively. Numeric input uses
  `keyboardType="decimal-pad"` and `parseDecimal` (accepts a comma).
- Adding food follows the web app's model. The tab bar's middle "+" (a
  disabled trigger, so it never selects) opens the shortcuts sheet; Search
  opens the add-food hub: a time chip, a calorie pill and the plate badge in
  the header, a Scan / Search / Recipes / Library / Shop strip, and the search
  field with "Log Foods (N)" in the bottom toolbar. A row's "+" stages its
  amount on the plate; everything on it is logged together. Swipe logs at once.
- Lists: swipe actions via `SwipeRow`, long-press context menus, pull to
  refresh through `Screen onRefresh`. Search uses the native search bar
  (`headerSearchBarOptions`).
- Pickers are native: segmented controls, date pickers and menus from
  `@expo/ui/community/*`. No hand-rolled dropdowns.
- Haptics (`lib/haptics.ts`): `success` when something is logged or saved,
  `selection` on picker changes, `impact` on a barcode read.
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
bunx expo prebuild --platform ios --no-install      # native project generation
```

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

`.github/workflows/release-macros-ios.yml` builds an unsigned IPA on a macOS
runner for every PR that touches this app, and publishes when `version` in
`package.json` changes on `main`: a `macros-ios-v<version>` GitHub release
with the IPA, plus the SideStore source regenerated from every release
(`scripts/compose-source.ts`) on the rolling `macros-ios-source` release.
SideStore re-signs the IPA with the user's Apple ID, which is why the app has
no entitlements: a free account cannot grant push, App Groups, HealthKit or
associated domains. Adding any of those breaks installation for free
accounts. Bump `version` for every release — SideStore detects updates by
version alone.
