# Stream (apps/stream)

Family film and series catalogue at `stream.denizlg24.com`: web UI (also the
TV client), `/api/v1/*` for `apps/stream-mobile` and `apps/stream-desktop`,
and the ingest jobs. Design and rollout: `docs/internal/plans/031-stream.md`.
Family-facing, so the storage copy rules apply: plain language, friendly
empty states. Owner-only detail lives on `/profiles` behind `role = owner`.

- **Plays nothing it doesn't own.** `lib/playback.ts` is the only place a
  `PlaybackSource` is made, and only from files on our own storage. No
  title has one yet. Never add resolvers, scrapers or third-party embeds.
- **A tenant, not a first-party client.** deniz auth gives first-party
  tokens to superusers only, so Stream is the owner's `family` tenant
  (`STREAM_TENANT_ID`). `isFamilyToken` is the admission test. Tokens never
  carry `superuser`, the owner's included. `STREAM_OWNER_SUBJECT` makes the
  owner's member row `owner`.
- **Two ways in to `/api/v1`.** A bearer (native clients), or the web
  session cookie on GET only. Every web write is a server action
  (`app/actions.ts`), so a cookie never authorises an API mutation.
- **The audience is the sofa.** `stream-sofa` holds the profile ids
  watching. Recommendations are cached per audience (`recommendations.audience`
  = sorted ids), any kids profile makes the whole audience kid-safe, and
  saves and progress apply to everyone sitting down. If anyone on the sofa
  prefers `classic`, the room gets classic.
- **Recommendations go through web's `llm-service`**
  (`POST /api/admin/stream/recommendations`, `client_credentials` with
  `STREAM_WEB_OAUTH_CLIENT_ID/SECRET`). The candidate pool is built here, and
  a pick outside it is dropped. Any failure falls back to genre affinity, so
  the programme never empties.
- **Taste space is fixed per title.** `lib/taste-space.ts` places every
  title from its genres and votes, deterministically, and ingest writes
  `map_x`/`map_y`/`mood`. Moving an anchor moves the whole map, so the next
  ingest rewrites every row.
- **Ingest upserts, never deletes.** A title under `STREAM_MIN_VOTES` keeps
  its rows. `POST /api/jobs/ingest` and `/api/jobs/enrich` (bearer
  `STREAM_CRON_SECRET`) answer 202 and log to `ingest_runs`. Nothing in this
  repo schedules them. Run them locally with `bun run ingest` / `bun run enrich`.
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
