# forge

Superuser-only Forge host and deployment dashboard. It combines host and
Forge-scoped Docker telemetry from `deploy-agent`, deployment history from the
cloud API, and live build/runtime logs.

## Local development

```sh
bun run dev:forge
```

The app listens on `http://localhost:3006` and defaults to the API at
`http://localhost:3001`.

## Vercel

Create a Next.js project rooted at `apps/forge`, with access to files outside
the root directory enabled. Set this on Production, Preview, and Development:

```text
NEXT_PUBLIC_CLOUD_API_URL=https://api.denizlg24.com
```

Production uses `forge.denizlg24.com`. Generated Vercel preview origins are not
trusted by the API. Forge-hosted `forge-server-*` deployment origins are trusted
so the app can authenticate during its bootstrap and domain migration; the
allowlist does not extend to other hosted projects.

## Deploying through Forge

Use the repository root as the build context and `apps/forge/Dockerfile` as the
Dockerfile path. The target must set:

```text
NEXT_PUBLIC_CLOUD_API_URL=https://api.denizlg24.com
```

The build argument is inlined into the client bundle. The container listens on
port `3006`; `/` is a valid health path and redirects unauthenticated requests
to `/login`.
