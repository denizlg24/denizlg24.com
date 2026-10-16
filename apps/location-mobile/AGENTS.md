# Location for iPhone

The owner's location recorder (`com.denizlg24.location`), for one user.
Single-user copy rules apply. Not published: `bun run ios:device` installs a
Release build signed through the Xcode account, like Hours and Voice.

## What it records

Everything is captured and uploaded in Swift (`modules/location-native`),
because iOS relaunches a terminated app for a location event without
starting JavaScript. `LocationAppDelegate` (an Expo app-delegate subscriber)
recreates the location manager at launch, which is the only way the
relaunch's event is delivered.

- **Visits** (`CLVisit`) and **significant changes** (~500 m): always on once
  "Always" is granted. Both relaunch the app and cost next to nothing.
- **Live trail** (standard updates, best accuracy, 10 m filter, thinned to
  20 m / 5 s): `liveMode` — `off`, `auto` (between a visit's departure and
  the next arrival, or a coarse fix above 3 m/s), `on`. Runs with
  `allowsBackgroundLocationUpdates`, the blue indicator and a
  `CLBackgroundActivitySession`.

Points and visits go to an on-disk queue (`LocationQueue`, Application
Support, readable after first unlock) and are POSTed to
`/api/admin/location/batch` in a background task: at once for a visit, else
at 50 points or 5 minutes, and on every foreground. Ids are minted on the
phone (visits: `v-<arrival epoch>`), so resends are idempotent; a 400 drops
that batch instead of blocking the queue behind it.

## Places and the in-store message

- **Places are found on the phone.** On a visit's *arrival* the tracker runs
  `MKLocalPointsOfInterestRequest` (150 m, 8 s cap) and sends the five
  nearest named places with the visit — Apple Maps' data, no key, no quota.
  A departure report carries none and the server keeps the arrival's.
- **The server judges each arrival once** (`apps/web/lib/location-insight.ts`,
  run in `after()` from the batch route, claimed on the row before any work).
  Code picks the shop — one he has bought from beats a nearer one he never
  has, within 75 m — matches it to his bank history by distinctive descriptor
  words, finds the envelope that history lands in and computes what is left
  per day. Only then does a model (`LOCATION_INSIGHT_MODEL`, default
  `anthropic/claude-haiku-5.5`) decide whether to notify and word it, from
  those figures alone; silence is the default. One message per shop per 12 h.
  The verdict, silent or not, is stored on the visit (`insight`) and shown in
  the Today list.
- **Push** goes to every `MobileDevice` with `app: "location"` as a
  time-sensitive alert (`pushLocationAlert` in `lib/mobile-push.ts`, the team
  APNs key). The app registers its token on every launch through
  `PUT /api/admin/mobile/devices/:id` and forgets it before sign-out. Builds
  from Xcode are development-signed, so `LOCATION_IOS_APS_ENVIRONMENT`
  defaults to `development` (sandbox APNs).

## Sign-in

`@repo/native-auth` like Hours: redirect `com.denizlg24.location:/oauth/callback`
on the "iPhone apps" native client (`MOBILE_OAUTH_CLIENT_ID` on web). The
session JSON lives in the keychain (`kSecAttrAccessibleAfterFirstUnlock`,
no App Group yet) and `Session.swift` refreshes it for the uploader.

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
