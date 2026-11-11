# Home, the living-room TV's launcher

`com.denizlg24.home`: the home screen of the Cepter Google TV
(`living-room-tv` on the tailnet; Android 14, 720p UI, 1.4 GB RAM, 32-bit).
It replaces Google's launcher. Family-facing in who uses it, but it carries
no copy at all: a clock, app names, what was last watched, three system
entries.

## Stack

Kotlin, plain Android views built in code, no AndroidX, no Compose, no
dependencies. The APK is about 240 KB and the process is a few MB; keep it
that way. A React Native or Compose launcher would cost more memory than
the stock one frees. Gradle 9.3 wrapper, AGP 8.12, compileSdk 36,
targetSdk 34, R8 on. Not a bun workspace (no `package.json`).

The look is Stream's (`apps/stream-mobile/src/ui/theme.ts`): ink, paper,
muted, amber; Big Shoulders for display, Atkinson Hyperlegible Next for the
rest, copied into `assets/fonts`. Stream's typography rules hold here: no
eyebrow labels, no tracked uppercase, no glyph standing in for an icon. No
banners, tiles or boxes: an app is its name, focus is paper over an amber
rule, progress is a hairline. The only image is the wallpaper.

## The screen

`HomeActivity` is everything. Rows are `RowScroll`: the focused item comes
to rest on the left margin and the row moves under it. Long-press OK on an
app opens its menu (move, remove from home, app info). All apps, Inputs
(passthrough `TvInputManager` inputs, opened through
`TvContract.buildChannelUriForPassthroughInput`) and the menus are pages
pushed over the home view; Back pops one, and Home always returns to the
first app.

- `HomeRow` (prefs) holds the row's order. The first run seeds Stream and
  the non-system apps; a newly installed app joins on its own; system apps
  start in All apps.
- Settings opens with `FLAG_ACTIVITY_CLEAR_TASK`. Without it the Settings
  task resumes wherever it was last left, which once was the Wireless
  debugging toggle.
- The window focuses the system row before the apps have loaded;
  `renderApps` moves focus to the first app once (`placed`).

## Continue watching

Google TV's Watch Next rows are readable only with
`ACCESS_ALL_EPG_DATA`, which is `signature|privileged`. So `Watching` has
two sources:

- **Published.** An app broadcasts
  `com.denizlg24.home.action.PUBLISH_WATCHING` with an `items` JSON array
  (`{ title, subtitle?, uri?, positionMs, durationMs, updatedAt }`)
  and `BroadcastOptions.setShareIdentityEnabled(true)`. The list is filed
  under `getSentFromPackage()` (Android 14 only) and an item's `uri` is only
  ever opened with `setPackage` of that sender. Stream does this from its
  TV Home tab (`apps/stream-mobile/src/lib/launcher.ts`,
  `modules/stream-tv` `publishWatching`), so its list is as fresh as the
  last time Stream's Home was open on this TV.
- **Observed.** `MediaWatcher` is a notification listener only because that
  is what lets a non-system app read media sessions. It records the last
  title each app played and how far; choosing one opens the app, not the
  episode. A published list replaces the observed entry for the same app.

## Wallpaper

One fixed picture behind the home view (`Wallpaper`), under a scrim that is
light at the clock and near ink under the rows. It is
`assets/wallpaper.jpg`, 1280 px wide, unless
`am start -n com.denizlg24.home/.HomeActivity --es wallpaper https://…`
has saved another to `files/wallpaper.jpg`. Watched items carry no artwork:
the owner asked for a set image rather than the last thing watched.

The bundled picture is "Tallinn Christmas Market at night in snow" by
jonathan exon, CC BY-SA 3.0, from Wikimedia Commons, scaled down.

## Installing on the TV

`scripts/tv.sh <host:port> install | provision [packages] | restore`.

- Signed with the debug key in `~/.android`. A different key means an
  uninstall first; only the row order and the watched list are lost.
- `provision` enables the listener, optionally sets the row
  (`--es home a,b,c` on `HomeActivity` is the adb way to set it), disables
  `com.google.android.apps.tv.launcherx` **and**
  `com.google.android.tungsten.setupwraith`, and halves the animation
  scales. Disabling the launcher alone hands Home to setupwraith's
  `RecoveryActivity` (HOME at priority 1; a third-party filter is capped at
  0), and shell may not disable a single component of another package.
  `set-home-activity` and the HOME role alone do nothing while the stock
  launcher is enabled.
- With the stock launcher off, its Quick Settings panel and notification
  listener are gone too. `restore` re-enables both packages.
- adb reaches the TV only over Tailscale. Wireless debugging picks a new
  port whenever it is toggled or the TV restarts, which is why the tailnet
  policy grants the MacBook `tcp:*` to the TV; scan 30000–49999 for it, then
  `adb tcpip 5555` for a port that lasts until the next restart. The TV's
  Tailscale does not reconnect by itself after a restart.
- Check what has focus (`uiautomator dump`) before sending OK from a
  script. A blind key sequence once walked into Settings.
