# Location for iPhone

The owner's location recorder (`com.denizlg24.location`), for one user.
Single-user copy rules apply. Not published: `bun run ios:device` installs a
Release build signed through the Xcode account, like Hours and Voice.

## What it records

Two things, captured and uploaded in Swift (`modules/location-native`)
because iOS relaunches a terminated app for a location event without
starting JavaScript; `LocationAppDelegate` recreates the location manager at
launch so that relaunch's event arrives.

- **Arrivals, always** (with "Always"), because they drive the in-store
  message. Three detectors, each covering the others' misses:
  - `CLVisit` — cheap and relaunching, but it skips most short stops (the
    four-minute Lidl stop on 2026-10-16 never became a visit).
  - **Shop geofences** (`ShopFences`): the 18 nearest shops whose names carry
    a merchant word from his card history (`GET /location/merchants`), found
    with one Apple Maps search per category within 1.5 km and re-searched
    every 600 m or 6 h. Entering one starts a GPS probe; staying within 40 m
    (plus accuracy) of the shop for a minute reports a `geofence` arrival,
    walking past reports nothing, and the probe gives up after 6 minutes.
    Probe fixes are never recorded.
  - **Stops on an explored trail**: 90 s within 40 m reports a `stop`.
  Each arrival carries the 10 nearest places (150 m), the fenced shop first.
- **The trail, only while Explore is on** — switched on when setting off and
  off on arrival, from the app, the Explore widget, the Control Center
  toggle, Siri or the Action Button. Standard updates (best accuracy, 10 m
  filter, thinned to 20 m / 5 s, fixes worse than 65 m dropped) with
  `allowsBackgroundLocationUpdates`, the blue indicator and a
  `CLBackgroundActivitySession`. Significant changes run with "Always" to
  relaunch a terminated app and move the fences along; their fixes are not
  recorded either.
- **The exploration lives in the App Group** (`ExploreStore`,
  `explore.json`): on/off, start and end, distance and the session's trail
  (thinned past 2 400 points). The app writes it; the widgets only read it.
  Starting clears the last trail; stopping keeps it for the Map widget.

Points go to an on-disk queue (`LocationQueue`, Application Support,
readable after first unlock) and are POSTed to
`/api/admin/location/batch` in a background task: while exploring at 5
points or 10 s, otherwise at 50 points or 5 minutes, at once on stopping
and on every foreground. Ids are minted on the phone, so resends are
idempotent; a 400 drops that batch instead of blocking the queue behind it.

## Map

`ExploredMapView` (in the pod) is MapKit with `GET /location/explored` — the
desktop's explored ground — drawn as a band 2 × 10 m wide at every zoom
(`MetricMultiPolylineRenderer` sets the stroke in map points), and the walk
in progress on top. The Map tab polls the session trail from the App Group
every 4 s. The Map widget renders an `MKMapSnapshotter` image of the latest
walk in the extension, light and dark.

## Widgets and intents

`targets/widgets`: Explore (small with a toggle button, two Lock Screen
sizes), Map (small/medium/large) and the Control Center toggle. The intents
(`modules/location-native/ios/Intents`) are `LiveActivityIntent`s, compiled
into the app and the extension, so `perform` runs in the app's process — the
only one that can start location updates. Starting from a widget while the
app is not running needs "Always". The tracker reloads widgets on every
switch and at most every 2 minutes while exploring.

## The in-store message

- **The server judges each arrival once** (`apps/web/lib/location-insight.ts`,
  run in `after()` from the batch route, claimed on the row before any work),
  whichever detector sent it (`source` on the visit).
- **Which place is the shop** (`buildStoreBrief` in `lib/location-brief.ts`):
  within 75 m, one he has bought from beats a nearer one he never has. A
  purchase belongs to the *merchant word* of its descriptor — the first word
  that is not a card prefix (`compra`, `estrang`, …), a word common across
  his merchants, or a kind of place (`cafe`) — because terminals print the
  brand first and the branch after; matching any word made "Lyngby Station"
  his Føtex. `identityDescriptor` splits names glued to store numbers
  (`LIDL247LYNGBY`, `REMA1000`), place names are tried with `ø` as both `o`
  and `oe` (`F?TEX`, `FOETEX`), and a merchant word may extend the place's
  (`lidlfisketorvet`). The phone's fence matching mirrors this in Swift.
- Then it finds the envelope that history lands in and what is left per day,
  and a model (`LOCATION_INSIGHT_MODEL`, default `anthropic/claude-haiku-5.5`)
  decides whether to notify and words it, from those figures alone; silence
  is the default. One message per shop per 12 h.
- **Push** goes to every `MobileDevice` with `app: "location"` as a
  time-sensitive alert (`pushLocationAlert` in `lib/mobile-push.ts`). The
  Explore tab lists today's arrivals with their detector and verdict.

## Sign-in

`@repo/native-auth` like Hours: redirect `com.denizlg24.location:/oauth/callback`
on the "iPhone apps" native client (`MOBILE_OAUTH_CLIENT_ID` on web). The
session JSON lives in the keychain (`kSecAttrAccessibleAfterFirstUnlock`,
not shared with the widget extension, which never calls the API) and `Session.swift` refreshes it for the uploader.

## Server

`apps/web`: `models/Location.ts` (`LocationPoint`, `LocationVisit`, kept
indefinitely, 2dsphere-indexed), `lib/location.ts`, routes under
`/api/admin/location` (current, `points`, `visits`, `batch`). Contracts are
`@repo/schemas` `location`.

## Checks

```
bun run typecheck && bun test
bunx expo prebuild --platform ios --clean
xcodebuild -workspace ios/Location.xcworkspace -scheme Location -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```
