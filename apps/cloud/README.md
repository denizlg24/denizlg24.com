# cloud — admin app (cloud.denizlg24.com)

Next.js admin surface for the self-hosted cloud. Superuser-only; talks to
`apps/api` with better-auth cross-subdomain sessions.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_CLOUD_API_URL` | `http://localhost:3001` | API base URL |
| `NEXT_PUBLIC_STORAGE_APP_URL` | `http://localhost:3005` | Storage app links (project folder deep links: `/folders/:id`) |
| `NEXT_PUBLIC_DISK_BAY_COUNT` | `12` | Minimum number of hot-swap bays rendered on the disks tab |

These are inlined at build time. The defaults point at local dev on purpose —
production values come from the Vercel project (`infra/vercel/SETUP.md`), so a
build that forgets them fails loudly instead of pointing this app at prod.

## Local development

```sh
bun run cloud:dev:infra                       # from repo root: postgres/mongo/redis/meili/docker-proxy
PORT=3001 bun --env-file=.env run --cwd apps/api dev
NEXT_PUBLIC_CLOUD_API_URL=http://localhost:3001 bun run --cwd apps/cloud dev   # serves on :3002
```

The app dev server is pinned to port `3002` and the API to `3001`; both are in
the API's trusted CORS/auth origins (`http://localhost:3000-3002`). Sessions
are cookie-based (`credentials: include`) — no client-side tokens.

Adminer and mongo-express (iframed by the databases screen through
`/api/ops/tools/*`) run with root DB credentials and no auth of their own, so
they sit behind an opt-in compose profile:

```sh
docker compose --env-file infra/compose/.env.dev \
  -f infra/compose/docker-compose.dev.yml --profile tools up -d
```

The first superuser for login is created with
`bun run --cwd apps/api auth:bootstrap-superuser <username>`
(`apps/api/scripts/bootstrap-superuser.ts`); it refuses to run once any user
exists.

## Conventions

- All fetches go through `lib/api.ts`; every response is validated with
  `@repo/schemas/cloud` zod schemas. No untyped fetch.
- Auth client: `@repo/cloud-auth-client` (`lib/auth-client.ts`).
- UI: `@repo/ui` primitives, editorial style — dense tables, hairlines,
  typographic hierarchy, restrained color. No cards, no explanatory copy.
