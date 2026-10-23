# Macros API compatibility

Macros 0.1.0 pins feature requests to `/api/v1`. An API version describes a
wire contract, independently of the app's semantic version. Released apps
continue to use `/api/*`; those URLs remain supported as the v1 contract.

The handlers currently under `app/api` implement v1. The explicit allowlist
in `lib/api/versioning.mjs` exposes those same handlers under `/api/v1` through
internal fallback rewrites. Methods, request bodies, query parameters, cookies,
status codes and response bodies are preserved, including multipart uploads.
Authentication stays at Better Auth's `/api/auth`; cron and admin routes are
not exposed through the versioned client namespace. Public assets, registration
pages and presigned object-storage URLs also keep their existing URLs.

For a backward-compatible change, keep existing fields and behavior working;
add optional fields rather than changing the meaning or type of existing ones.
Do not make a new field required for v1 callers. Shared schemas in
`packages/schemas/src/macros` currently describe this v1 contract.

For a breaking change:

1. Add explicit `app/api/v2/...` handlers and separate v2 schemas. Retain v1's
   handlers, schemas and legacy URLs. Share business logic where the two
   contracts agree, translating at the route boundary where they differ.
2. Pin the new client to v2 only once those endpoints are deployed. Never
   redirect old clients to the latest version. Unknown versions return 404.
3. Test both contracts and migrate persisted reads and queued mutation
   variables explicitly if a new app build needs a different local format.
4. Keep database migrations compatible with both live API versions. An API
   prefix alone cannot protect old clients from a destructive schema change.

Physical versioned routes take precedence over fallback aliases. Existing
v1 endpoints can therefore be extracted into `app/api/v1` later without
changing client URLs. Do not change the v1 alias list to point to v2.

## Food and icon cache revisions

`packages/schemas/src/macros/cache-versions.ts` is the single place to bump
`MACROS_CACHE_VERSIONS.foods` or `.foodIcons`. Use any new opaque value, such
as a date, hash or incremented suffix, then deploy the backend. Versions are
compared by equality, so rolling the backend back also triggers a refresh.

`GET /api/v1/cache-versions` is public and sends `Cache-Control: no-store`.
Clients from 0.1.0 onward check at launch, foreground and reconnect. A food
revision invalidates food-containing query domains; an illustration revision
changes icon/catalogue URLs and their query keys. Unaffected caches stay put.
Cached food data remains usable offline, and an unavailable policy endpoint
uses the last successfully fetched policy (or the bundled defaults).

Deploy changed assets/data and their policy together. A food revision is for
catalogue or assignment changes, not for rewriting historical nutrition.
Older binaries cannot acquire this revalidation behavior until updated.

The persistence buster in the native `lib/food-cache.ts` describes the storage
format, not content or app releases. Never bump it to refresh food or artwork:
discarding that storage would also discard paused offline mutations. Migration
from the old `<app-version>:1` buster retains its queries and pending writes;
the existing seven-day persistence retention limit is unchanged.
