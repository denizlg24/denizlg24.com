# Vercel projects

Create two Vercel projects from `denizlg24/denizlg24.com`. Do not change the
current production DNS during plan 011.

| Project | Root directory | Production domain |
|---|---|---|
| `deniz-cloud` | `apps/cloud` | `cloud.denizlg24.com` |
| `deniz-storage` | `apps/storage` | `storage.denizlg24.com` |

## Environment variables

### `deniz-cloud`

Add these variables to the **Production**, **Preview**, and **Development**
environments:

| Variable | Value | Used for |
|---|---|---|
| `NEXT_PUBLIC_CLOUD_API_URL` | `https://api.denizlg24.com` | Browser API and Better Auth base URL |
| `NEXT_PUBLIC_STORAGE_APP_URL` | `https://storage.denizlg24.com` | Links from the cloud app to storage folders |
| `NEXT_PUBLIC_DISK_BAY_COUNT` | `12` | Minimum number of hot-swap bays rendered on the disks tab |

These are the only environment variables currently used by `apps/cloud`.
They are public build-time values embedded into the Next.js client bundle, so
set them before each deployment — the in-code fallbacks are `localhost`, not
production, so a deployment missing them is broken rather than silently
pointing at the live API. Set `NEXT_PUBLIC_DISK_BAY_COUNT` to
the number of physical bays you want the rack to show; discovered disks are
always added if that value is too small. The API does not need to be deployed
for the Vercel build to pass; the cloud app will simply show API/network errors
until `https://api.denizlg24.com` is live.

Do **not** copy the root `.env.example` into this project. `DATABASE_URL`,
`BETTER_AUTH_SECRET`, Redis, Meilisearch, S3, terminal, and other private
variables belong to the self-hosted `apps/api` service, not to the Vercel
client app. The cloud app has no direct database or secret access.

### `deniz-storage`

No environment variables are currently required. The app is only a placeholder
and does not yet call the API or storage service.

## Vercel project settings

For each project:

1. Import the GitHub repository and select the Next.js framework preset.
2. Set the root directory shown above and keep access to files outside the
   root directory enabled so Bun can resolve the root lockfile and
   `@repo/ui`.
3. Use Bun with install command `bun install --frozen-lockfile`.
4. Keep build command `bun run build` and output directory `.next`.
5. Add the environment variables listed above to the matching project. For
   `deniz-cloud`, use `https://api.denizlg24.com` even before the API is
   deployed; this is enough for the Next.js build and keeps the eventual URL
   stable.
6. Attach the listed domain to the project, but leave the existing DNS target
   unchanged. Plan 012 owns the DNS switch.
7. Leave GitHub preview deployments enabled for pull requests.

Before the DNS switch, verify both generated `*.vercel.app` production URLs
and a pull-request preview. The pages can be checked before the API exists,
but API-backed routes and login will not work until the API is deployed. Once
the API is live, redeploy `deniz-cloud` after confirming its URL and verify
that the API allows `https://cloud.denizlg24.com` as a trusted browser origin.
