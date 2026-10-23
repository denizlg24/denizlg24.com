# Stream deployment

Forge builds `apps/stream/Dockerfile` from this monorepo, serves port 3011,
and checks `/healthz`. The production target follows `main`; previews are
kept off because OAuth callbacks and household data are production-scoped.
A one-off deployment from the reviewed feature branch can bootstrap the site.

Set `STREAM_URL=https://stream.denizlg24.com`, `STREAM_DATABASE_URL`,
`STREAM_TENANT_ID`, `STREAM_OWNER_SUBJECT`, `DENIZ_AUTH_ISSUER`,
`DENIZ_AUTH_CLIENT_ID`, `DENIZ_AUTH_CLIENT_SECRET`, `DENIZ_AUTH_SECRET`,
`AUTH_APP_URL=https://auth.denizlg24.com`, `STREAM_NATIVE_OAUTH_CLIENT_ID`,
and the tenant's logical `STREAM_RESOURCE` audience. The audience is an
identifier, not a URL clients fetch. Add admitted family account ids to
`STREAM_FAMILY_SUBJECTS`, separated by commas. The owner is always admitted.
Never set `STREAM_DEV_SUBJECT` in production.

`STREAM_TMDB_TOKEN` enables enrichment. `STREAM_WEB_URL` and
`STREAM_WEB_OAUTH_CLIENT_ID/SECRET` enable the recommendation service; the
local preference ranking remains available if that service is unreachable.
`STREAM_CRON_SECRET` protects the ingest and enrichment job endpoints.

Before deploying a schema change, run `bun run db:migrate` with the production
`STREAM_DATABASE_URL` in the environment. Forge does not run migrations.
The initial migration creates `pg_trgm`; the resource's Postgres role needs
permission to install it. IMDb/TMDB ingestion upserts metadata, not video.

CI (`stream.yml`) checks types, tests, a production web build and iOS/Android
JS bundles. Its Postgres integration tests use an isolated temporary schema
and cover household profile access, profile limits, progress and actor search.
`personal-ios.yml` compiles an unsigned iOS archive. Desktop version releases
use `release-stream-desktop.yml`; updater signing uses the repository secret
`STREAM_DESKTOP_TAURI_SIGNING_PRIVATE_KEY`. Store distribution of mobile apps
requires a separate signing/release setup; the CI bundles are validation artifacts.

Regenerate all brand assets with `bun run --cwd apps/stream-mobile icons`,
then `bun run --cwd apps/stream-desktop icons`. The mobile generator also
writes web icons and the Open Graph image. Keep generated assets committed.
