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
  409 `needs_setup` → Welcome (name + colour, `POST /me`), then "Who's watching?";
  anything else that fails (503 `auth_unavailable`, offline) → retry
  screen, never a sign-out. `lib/member-status.ts` decides. Any other 401
  signs out (the SDK already refreshed before expiry).

## The phone: one navigator, Netflix's layout

`lib/audience.ts` (pure, tested): who is watching is stored in SecureStore;
stale ids drop out; an account with one profile never sees "Who's
watching?"; the first seated profile leads and profile-scoped routes
(progress, list, `?profile=`) use it. `?profiles=` routes (`/browse`,
`/search`, `/titles/:id/similar`) take the whole audience. A profile's
`layout` no longer picks a navigator: `classic` on the wire means "Larger
text", and the phone wraps its stack in `TextScaleContext`
(`LARGER_TEXT_SCALE`), which every `Text` reads. It never limits who can
watch together.

`app/_layout.tsx` (`PhoneNavigator`) gates with `Stack.Protected`: `(tabs)`
(native tabs Home · New & Popular · My Stream), `title/[id]`, `watch/[id]`,
`actor/[name]`, `browse` (any `GET /titles` query as a three-up grid:
a row's `more`, a genre, a keyword), `list`, `search`, `ask`, `categories`
(transparent genre picker) and `account`; `who` and `profile-edit` are
reachable always. `/` redirects to `/home`.

- **Who's watching?** (`features/profiles/who-screen.tsx`): tap a profile to
  start; "Watch together" turns the tiles into toggles with a Start button;
  Edit opens the profile editor.
- **Home** (`features/browse`): a top bar that darkens with the scroll,
  Series / Films chips switching `/browse`'s `tab`, Categories, the
  billboard card, then rows by kind (`rows.tsx`: posters, `wide` stills,
  `top10` with outlined numerals, `continue` with progress, episode and
  Info). Every row is a horizontal `FlatList` with `getItemLayout`; tile
  sizes come from `metrics.ts`, scaled to the screen width.
- **New & Popular**: `tab=new` rows as sections of wide cards, a date column
  (`lib/release.ts`) or the Top 10 numeral beside each.
- **Search**: debounced (`lib/use-debounced.ts`); empty shows popular
  searches; results are a poster grid with people, genre and keyword chips
  that open `/browse`. "Not sure what to watch?" opens Ask.
- **My Stream**: the audience, Continue watching, My List, Recently finished
  (`grid/highlights` watched ids, detailed through `useTitleDetails`), and
  settings rows.
- **Title**: backdrop (tap plays the trailer on YouTube), logo or name,
  facts, Play/Resume, overview and credits that expand, My List, then tabs
  Episodes (season picker modal) · More like this · Trailers.

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
captions menu lists the stream's own tracks. The phone's embed shows the
provider's own control bar, captions included; only the TV and the web
clip it and use `/subtitles` instead.

## Google TV

The same APK. `Platform.isTV` switches the root layout to its own stack
(`app/tv/*` over `features/tv`), laid out like Netflix on a TV: sign-in by
code, "Who's watching?" (OK starts; Watch together turns the tiles into
toggles), Home / Series / Films / New & Popular (`browse-screen.tsx` over
`useBrowse`), Search (on-screen keyboard, `useSearch`), My List, the title
page (Episodes, More like this, cast), `collection` (a genre or keyword
grid), actor pages, Ask (from Search) and the player. Landscape throughout;
overscan margins are `TV_SAFE`, sizes in `features/tv/layout.ts`.

- **Browsing screens sit in `TvShell`**: a left rail collapsed to icons.
  Left from the first column lands on an invisible full-height catcher that
  opens the rail onto the current section; Right from the rail lands on a
  second catcher (`nextFocusRight`) that sends focus back through the
  screen's `FocusMemory` (`focus-memory.ts`: every `Focusable` with a
  `focusKey` notes itself; `restore` turns one item's `preferred` true, so
  only that item re-renders). Back opens the rail; Back in the rail goes
  Home, and on Home leaves the app.
- **Rows scroll only where we say.** Vertical and horizontal lists run with
  `scrollEnabled={false}` and `scrollsChildToFocus={false}`, so Android's
  focus search moves focus and nothing scrolls natively; the focused row
  snaps under the billboard and the focused tile to the content's left edge
  with animated `scrollTo`. Each row remembers its column and redirects an
  arriving focus to it. The last tile traps Right (`next={{ right: "self" }}`,
  Android's `nextFocus*` with the view's own id) so focus never jumps rows.
  The billboard's buttons are focusable only while the first row (or they)
  have focus; hidden, they would win Up from every row.

- **Moving focus must re-render nothing.** `Focusable` animates its ring and
  lift with shared values (a function child is the only thing that re-renders
  on focus), and what the remote rests on lives in a `useSpotlight` store,
  read only by the backdrop and spotlight (`useSpot`) and settled for 160 ms.
  Rails and grids are memoised and take `spotlight.set`, which is stable.
  Putting the focused title back in a screen's state re-renders every poster
  on every press, which is what made the TV slow.
- **The system's grey focus box is off** (`android:defaultFocusHighlightEnabled`
  in the theme, from `with-android-tv`). It drew over every focused view at
  its unscaled bounds, beside the amber ring. Scrolling rows leave
  `FOCUS_ROOM` around their items so a lifted, ringed item is not clipped.
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
- **Subtitles are ours.** The provider's own menu sits in the control bar
  pushed off screen, so Subtitles in the controls opens `TvSubtitleMenu`
  over `/titles/:id/subtitles`. The chosen file goes to the provider as
  `sub_url` (`embedPlayerUrl`), which wins over everything it would pick;
  Off is a file with no cues. Changing it reloads the embed and seeks back
  to the same moment. The choice is per device (`lib/subtitle-preference.ts`,
  `auto` | `off` | a language), resolved per title with `pickSubtitle` and
  fixed once the WebView opens — a refetched list must never reload it.
- **The WebView is `EmbedSurface`, memoised with stable callbacks.** The
  player's clock ticks twice a second; the provider's page must not
  re-render with it.
- **`plugins/with-android-tv.js`** adds `LEANBACK_LAUNCHER`, the
  `@drawable/tv_banner` (`assets/tv-banner.png`, drawn by `bun run icons`)
  and leanback/touchscreen as optional features, so phones still install it.

## Updates

The APK is installed by hand, so the app updates itself on Android (phone
and Google TV alike): `features/update/update-prompt.tsx` asks
`GET /api/public/app/android` on launch and on returning to the
foreground, at most every 6 h, compares with `expoConfig.version`
(`lib/app-update.ts`, tested), and offers the newest signed release.
"Update now" downloads the APK into the cache (`expo-file-system/legacy`,
for progress) and hands its content URI to the system installer through
`expo-intent-launcher`; `REQUEST_INSTALL_PACKAGES` is in `app.config.ts`.
Android itself asks the person to allow installs from Stream the first time.
"Later" holds for a day per version. iOS shows nothing. 0.3.0 is the first
version with the updater: anything older has to be installed by hand once.

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
