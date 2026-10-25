# Stream for iPhone and Android

The family catalogue client (`com.denizlg24.stream`, schemes
`com.denizlg24.stream` and `stream`) for `apps/stream`'s `/api/v1`. Plan
031, "Design" section, is the spec. Family-facing: the storage-app copy
rules apply — plain language, friendly empty states, guidance on every
dead end. `/playback` supplies media identity: direct files use expo-video,
while `embedPlayerUrl` selects the underlying event-enabled embed for a WebView.
Never add resolvers or scrapers.

## Stack

Expo SDK 57, RN 0.86, expo-router (`src/app`, thin route files over
`src/features`), TanStack Query, Reanimated 4 + gesture-handler, expo-image,
expo-video, lucide icons. Local UI kit in `src/ui` — `@repo/native-ui` is
not used: its colours are `DynamicColorIOS` (iOS only) and its palette is
the admin apps'. Dark only. Type is Big Shoulders 800/900 for display
(line height about 0.92 of the size) and Atkinson Hyperlegible Next 400/700
for everything else, both embedded on both platforms (`plugins/fonts.cjs`);
weight comes from the family, never `fontWeight`. Tabular numerals
everywhere (`Text` sets them).

Typography rules the owner holds to: no eyebrow or kicker labels over
headings, no tracked uppercase, no section numbering, no italic
pull-quotes, no monospace, and no Unicode glyph standing in for an icon —
ratings are a filled lucide `Star` (`MetaRow`, `Rating`), and meta facts
are separated by space, not dots. The wordmark is `Wordmark` (filled amber
Play, then STREAM in Big Shoulders Black). Contracts are `@repo/schemas/stream`; the only local
wire shapes are the three bare wrappers the routes answer with
(`{ title, inWatchlist, progress }`, `{ episodes }`, `{ titles }`).

## Sign-in

`@denizlg24/auth/client` `createPublicClient`, built lazily from
`GET /api/public/native-auth` (`{ issuer, clientId, resource }`, kept in
SecureStore so a cold start offline still finds the session). PKCE through
`expo-web-browser` `openAuthSessionAsync` (not ephemeral), redirect
`com.denizlg24.stream:/oauth/callback`, tokens in SecureStore
(`lib/secure-storage.ts` maps the SDK's `:` keys to SecureStore's
`[\w.-]`). Tokens are tenant tokens (`family`), never superuser.

- The SDK is browser-shaped: `lib/polyfills.ts` supplies
  `crypto.subtle.digest`/`getRandomValues` (expo-crypto),
  `AbortSignal.timeout` and a UTF-8 `TextDecoder` for `jose`. It is the
  root layout's first import; keep it first.
- The SDK's exports point at `dist/`, which a clone does not have. `dev`,
  `ios`, `android` and `bundle` build it first (`auth-sdk` script);
  typecheck through turbo (`bunx turbo typecheck --filter=stream-mobile`),
  whose `^build` builds it once. Rebuilding it inside `typecheck` raced every
  other package reading `dist/` in the same turbo run.
- `GET /me`: 403 `not_a_member` → "not on the list" screen with Sign out;
  409 `needs_setup` → Welcome (name + colour, `POST /me`), then the sofa;
  anything else that fails (503 `auth_unavailable`, offline) → retry
  screen, never a sign-out. `lib/member-status.ts` decides. Any other 401
  signs out (the SDK already refreshed before expiry).

## The sofa and the two layouts

`lib/audience.ts` (pure, tested): the sofa's choice is stored in
SecureStore; stale ids drop out; an account with one profile never sees
the sofa; the first seated profile leads — its `layout` picks the
navigator and profile-scoped routes (progress, list, `?profile=`) use it.
A classic profile is single-select and starts at once. `?profiles=` routes
(`/tonight`, `/grid/highlights`) take the whole audience.

`app/_layout.tsx` gates with `Stack.Protected`: `(studio)` (native tabs
Tonight · Tune · Map · Shelf · Ask), `(classic)` (expo-router/ui tabs as four
big labelled buttons along the top, ~20 pt type; its Ask is `/ideas`
because both groups share one URL space), shared `title/[id]`,
`watch/[id]`, `account`; `sofa` is reachable always. `/` redirects by
layout.

- **Tune** — `features/tune/dials.ts` (pure, tested) maps stop indices to
  `TitleFilters` (`runtimeMax`, a ±0.35 `moodMin/moodMax` window, decade
  `yearFrom/yearTo`, `ratingMin`, `type`). `TunerBand`/`RangeBand` run the
  needle on the UI thread with a haptic tick per stop and commit on lift.
  The grid is an `Animated.FlatList` with `itemLayoutAnimation`.
- **Map** — endless fixed-size poster grid (`features/grid`). A pan runs
  on the UI thread, renders only the visible cells plus a margin, and snaps
  to the nearest cell with light momentum. Tap once to focus and again to
  open the title. `grid/meta`, `grid`, and `grid/highlights` take the whole
  audience; aligned 24×16 blocks wrap on the torus and cache by audience,
  filter and block coordinates. No zoom or scatter-map routes remain.

## Player

`features/player`: one `PlayerController` interface; `useVideoController`
wraps expo-video, `UNAVAILABLE` is the same chrome with nothing to play
("Not available to play yet" over the backdrop, controls disabled). Custom controls only (`nativeControls={false}`); AirPlay is the
system `VideoAirPlayButton` (`airplay-button.android.tsx` renders nothing).
Progress: every ~10 s while playing, on pause, on close
(`use-progress-reporter.ts`, `shouldReportProgress`). VidSrc embeds use
`embed-player.tsx` and `/profiles/[id]/viewing` for everyone on the sofa: save
the selected episode on load, bridge validated `PLAYER_EVENT` messages to
`/progress`, and restore the saved timestamp with a seek command. Completion
opens a cancellable countdown. Block popup windows and top-level navigation
away from the player; do not pass app credentials into a WebView. A native rebuild is required after adding react-native-webview.
Resume past 30 s and
before 95 % (`resumePosition`). The screen is landscape through the stack's
`orientation` option; every other screen asks for portrait. `/playback`'s
`textTracks` are not used: expo-video cannot side-load subtitles, so the
captions menu lists the stream's own tracks.

## Google TV

The same APK. `Platform.isTV` switches the root layout to its own stack
(`app/tv/*` over `features/tv`): sign-in by code, "Who's watching?", Home
(rails under a backdrop that follows focus), Search, My list, the title page
and the player. Landscape throughout; overscan margins are `TV_SAFE`.

- **Sign-in is RFC 8628, not PKCE** — a TV has no browser. The SDK's
  `startDeviceSignIn()` asks `POST /api/auth/device/code`; the screen shows
  the code and a QR of `verification_uri_complete`
  (`auth.denizlg24.com/device`), and polls until someone approves on their
  phone. The Stream client's `grant_types` must list
  `urn:ietf:params:oauth:grant-type:device_code`, or the code request is a
  400 and the TV says so.
- **Focus is Android's own.** Core React Native moves focus between
  focusable views and turns OK into `onPress`; no `react-native-tvos`.
  `Focusable` draws the ring; `Button` and `IconButton` invert to paper when
  focused. `preferred` (Android's `hasTVPreferredFocus`, typed as Apple TV
  only) picks each screen's first focus.
- **Remote keys come from `onHWKeyEvent`** (`features/tv/remote.ts`), which
  React Native's root view emits for every D-pad and media key wherever focus
  is. Back is `BackHandler`.
- **The player never lets focus reach the picture.** Hidden controls leave
  a full-screen catcher focused, so an embed's page cannot take a key (its
  adverts included); the WebView is `focusable={false}` behind
  `pointerEvents="none"`. The embed is driven like the web player: `play`,
  `pause`, `seek<s>` posted to `player_iframe`, a clock interpolated between
  `PLAYER_EVENT`s. The provider's landing page only builds its player on a
  real tap, and Android injects scripts into the top frame only, so
  `modules/stream-tv` (a local Expo module, Android only) dispatches a touch
  at the middle of the WebView 3 s after load and on OK before it is ready.
  The provider's own title strip and control bar are pushed off screen
  (64/96 dp, as on the web). Arrow presses seek through `useSeekBuffer`: one
  seek once they stop.
- **`plugins/with-android-tv.js`** adds `LEANBACK_LAUNCHER`, the
  `@drawable/tv_banner` (`assets/tv-banner.png`, drawn by `bun run icons`)
  and leanback/touchscreen as optional features, so phones still install it.

## Android

No `PlatformColor`, `ActionSheetIOS`, `Alert.prompt` or toolbar buttons
anywhere; `Alert.alert` with buttons is the only system dialog used.
Sheets are `formSheet` on iOS and a plain modal on Android. Tab glyphs
carry both `sf` and `md` names. Fonts resolve by PostScript name on iOS and
file name on Android (`ui/theme.ts`).

## Checks

```
bunx turbo typecheck --filter=stream-mobile && bun test
bunx biome check apps/stream-mobile
bunx expo export --platform ios --output-dir /tmp/stream-ios
bunx expo export --platform android --output-dir /tmp/stream-android
```

The APK is `release-stream-mobile.yml`: PRs touching native config build it
debug-signed; a `package.json` version bump on main re-signs it in the
`stream-release` environment (`STREAM_ANDROID_KEYSTORE`, `_KEYSTORE_PASSWORD`,
`_KEY_ALIAS`, `_KEY_PASSWORD`) and publishes `stream-android-v<version>`, never
"latest". Never rotate that key: Android refuses an update signed by another.

`ios/` and `android/` are generated (`bun run prebuild`), never committed.
`bun run icons` redraws the icon, splash mark and the film-grain tile.
