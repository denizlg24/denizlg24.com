# cloud — admin app (cloud.denizlg24.com)

Next.js admin surface for the self-hosted cloud. Superuser-only; talks to
`apps/api` with better-auth cross-subdomain sessions.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_CLOUD_API_URL` | `https://api.denizlg24.com` | API base URL |
| `NEXT_PUBLIC_STORAGE_APP_URL` | `https://storage.denizlg24.com` | Storage app links (project folder deep links: `/folders/:id`) |
| `NEXT_PUBLIC_DISK_BAY_COUNT` | `12` | Minimum number of hot-swap bays rendered on the disks tab |

## Local development

```sh
bun run cloud:dev:infra                       # from repo root: postgres/mongo/redis/meili/docker-proxy (+ adminer, mongo-express)
PORT=3001 bun --env-file=.env run --cwd apps/api dev
NEXT_PUBLIC_CLOUD_API_URL=http://localhost:3001 bun run --cwd apps/cloud dev   # serves on :3002
```

The app dev server is pinned to port `3002` and the API to `3001`; both are in
the API's trusted CORS/auth origins (`http://localhost:3000-3002`). Sessions
are cookie-based (`credentials: include`) — no client-side tokens.

A dev superuser for login can be created with
`apps/api/scripts/ops-smoke-user.ts` (see apps/api README).

## Conventions

- All fetches go through `lib/api.ts`; every response is validated with
  `@repo/schemas/cloud` zod schemas. No untyped fetch.
- Auth client: `@repo/cloud-auth-client` (`lib/auth-client.ts`).
- UI: `@repo/ui` primitives, editorial style — dense tables, hairlines,
  typographic hierarchy, restrained color. No cards, no explanatory copy.
