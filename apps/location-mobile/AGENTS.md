# Location for iPhone

The owner's location recorder (`com.denizlg24.location`), for one user.
Single-user copy rules apply. Not published: `bun run ios:device` installs a
Release build signed through the Xcode account, like Hours and Voice.

## What it records

Nothing, unless Explore is on. The owner switches it on when setting off
and off on arrival — in the app, from the Explore widget, the Control Center
toggle, Siri or the Action Button. Everything is captured and uploaded in
Swift (`modules/location-native`), because iOS relaunches a terminated app
for a location event without starting JavaScript; `LocationAppDelegate`
recreates the location manager at launch so that relaunch's event arrives.

- **Exploring** runs standard updates (best accuracy, 10 m filter, thinned to
  20 m / 5 s, fixes worse than 65 m dropped) with
  `allowsBackgroundLocationUpdates`, the blue indicator and a
  `CLBackgroundActivitySession`. Significant changes run alongside only so a
  terminated app is relaunched mid-walk. Off, nothing is monitored — not
  even visits, which older builds left running and `apply()` now stops.
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

## In-store messages (dormant)

The server still judges visit arrivals and pushes a time-sensitive message
(`apps/web/lib/location-insight.ts`, `pushLocationAlert`), but the app no
longer records visits, so nothing arrives to judge. The push registration is
kept so it can come back without a release of the server.

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
