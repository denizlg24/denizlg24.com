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
  `ios`, `android`, `bundle` and `typecheck` build it first (`auth-sdk`
  script).
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
Tonight · Tune · Map · Shelf), `(classic)` (expo-router/ui tabs as three
big labelled buttons along the top, ~20 pt type), shared `title/[id]`,
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

## Android

No `PlatformColor`, `ActionSheetIOS`, `Alert.prompt` or toolbar buttons
anywhere; `Alert.alert` with buttons is the only system dialog used.
Sheets are `formSheet` on iOS and a plain modal on Android. Tab glyphs
carry both `sf` and `md` names. Fonts resolve by PostScript name on iOS and
file name on Android (`ui/theme.ts`).

## Checks

```
bun run typecheck && bun test
bunx biome check apps/stream-mobile
bunx expo export --platform ios --output-dir /tmp/stream-ios
bunx expo export --platform android --output-dir /tmp/stream-android
```

`ios/` and `android/` are generated (`bun run prebuild`), never committed.
`bun run icons` redraws the icon, splash mark and the film-grain tile.
