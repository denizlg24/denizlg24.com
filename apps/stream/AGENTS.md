# Stream (apps/stream)

Family film and series catalogue at `stream.denizlg24.com`: web UI (also the
TV client), `/api/v1/*` for `apps/stream-mobile` and `apps/stream-desktop`,
and the ingest jobs. Design and rollout: `docs/internal/plans/031-stream.md`.
Family-facing, so the storage copy rules apply: plain language, friendly
empty states. Owner-only detail lives on `/profiles` behind `role = owner`.

- **Playback contracts distinguish files, embeds and trailers.** `lib/playback.ts`
  selects the title/episode and returns VidSrc's documented IMDb embed URL in
  `Playback.embed`; it never treats an HTML page as a direct `PlaybackSource`.
  Web/desktop use an iframe; mobile uses a WebView. Never add resolvers
  or scrapers. Clients use the underlying `vsembed.ru` embed directly to
  avoid the outer ad scripts and receive VidAPI `PLAYER_EVENT` messages. Verify
  message origin, frame source and media identity before saving timestamps via
  `/progress`. Restore saved time with the player seek command. `/viewing` saves
  selections and manual completion; never estimate time from sound or a timer.
  Completion opens a cancellable next-episode countdown. Official YouTube
  trailers use `Playback.trailer` and never save viewing progress. Episode previews come from cached TMDB season details and
  fall back to IMDb metadata when TMDB is unavailable.
- **A tenant, not a first-party client.** deniz auth gives first-party
  tokens to superusers only, so Stream is the owner's `family` tenant
  (`STREAM_TENANT_ID`). `isFamilyToken` is the admission test: the owner
  plus `STREAM_FAMILY_SUBJECTS` (comma-separated deniz auth user ids). A tenant
  token alone never grants access to the shared household. Tokens never
  carry `superuser`, the owner's included. `STREAM_OWNER_SUBJECT` makes the
  owner's member row `owner`.
- **Two ways in to `/api/v1`.** A bearer (native clients), or the web
  session cookie on GET only. Every web write is a server action
  (`app/actions.ts`), so a cookie never authorises an API mutation.
- **Profiles belong to the household.** Every admitted member can select and edit
  every profile. `member_subject` records who created it; it is not an access
  boundary. First sign-in creates a profile only if the household has none.
  Creation/deletion take a transaction lock around the household-wide five-profile
  limit and the last-profile guard.
- **The audience is the sofa.** `stream-sofa` holds the profile ids
  watching. Recommendations are cached per audience (`recommendations.audience`
  = sorted ids), any kids profile makes the whole audience kid-safe, and
  saves and progress apply to everyone sitting down. If anyone on the sofa
  prefers `classic`, the room gets classic.
- **Recommendations go through web's `llm-service`**
  (`POST /api/admin/stream/recommendations`, `client_credentials` with
  `STREAM_WEB_OAUTH_CLIENT_ID/SECRET`). The candidate pool is built here, and
  a pick outside it is dropped. Language interest comes from positive viewing/saves (English at cold start);
  group ranking rewards shared tastes. Double bills match language and genre
  similarity, then audience rank. Any failure falls back to genre affinity, so
  the programme never empties.
- **The assistant (`/ask`, `GET /api/v1/assistant?q=`) is two model calls.**
  Web's `/api/admin/stream/assistant` turns the prompt into catalogue filters
  (`assistantIntentSchema`). `lib/assistant.ts` builds a kid-safe pool from
  them, relaxing the soft filters when fewer than 30 match, plus titles near
  any "like X". The recommendations route then ranks within that pool with
  the prompt. Without the model, the prompt's words become keywords and the
  pool's own order is served (`personal: false`).
- **Taste space is fixed per title.** `lib/taste-space.ts` places every
  title from its genres and votes, deterministically, and ingest writes
  `map_x`/`map_y`/`mood`. Moving an anchor moves the whole map, so the next
  ingest rewrites every row.
- **Ingest upserts, never deletes.** A title under `STREAM_MIN_VOTES` keeps
  its rows. `POST /api/jobs/ingest` and `/api/jobs/enrich` (bearer
  `STREAM_CRON_SECRET`) answer 202 and log to `ingest_runs` when they finish.
  Picron on pi-cloud schedules them: ingest daily at 04:30, enrich hourly at
  :15 with `limit=3000`. Most catalogue screens hide titles without a poster,
  so an enrich backlog reads as missing films. Run them locally with
  `bun run ingest` / `bun run enrich`.
- **Forge never migrates.** `bun run db:migrate` (env `.env.stream`) before
  merging a schema change. `0000_init` creates `pg_trgm`.
- **TMDB images are hot-linked** at TMDB's own sizes (`tmdbImage`), not
  through `next/image`, which would proxy every poster through this host's
  memory. The attribution line in the Tonight footer is required by TMDB's
  terms.
- **TV:** `components/spatial-nav.tsx` moves focus between `[data-nav]` with
  the arrows. An element claims arrows with `data-nav-own` (dials, the map,
  the player). TV mode comes from the user agent or the `stream-tv` cookie
  (toggle on `/profiles`).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
