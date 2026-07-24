# Vercel projects

Two Vercel projects build from `denizlg24/denizlg24.com`. Do not change the
current production DNS during plan 011.

| Project | Root directory | Production domain |
|---|---|---|
| `cloud-denizlg24` | `apps/cloud` | `cloud.denizlg24.com` |
| `storage-denizlg24` | `apps/storage` | `storage.denizlg24.com` |

(These are the names the projects were actually created under; earlier drafts
of this file called them `deniz-cloud` and `deniz-storage`.)

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

Add these to **Production**, **Preview**, and **Development**:

| Variable | Value | Used for |
|---|---|---|
| `NEXT_PUBLIC_CLOUD_API_URL` | `https://api.denizlg24.com` | Browser API and Better Auth base URL |
| `NEXT_PUBLIC_STORAGE_APP_URL` | `https://storage.denizlg24.com` | Origin the app builds share links against |

Both are public build-time values inlined into the client bundle, so they must
be set before each deployment. The in-code fallbacks are `localhost`, never
production: a deployment that forgets them is visibly broken rather than
quietly reading and writing real users' files.

`NEXT_PUBLIC_STORAGE_APP_URL` has to match the domain users actually visit.
Share links are built from it, so a wrong value produces links that resolve to
the wrong host — and it must be the same value the `deniz-cloud` project uses,
since the admin app deep-links into `/folders/:id` here.

This app has no database or secret access. Everything else it needs — storage
paths, `JWT_SECRET` for signing share tokens, `STORAGE_ARCHIVE_MAX_BYTES` —
belongs to the self-hosted `apps/api` service, not to this Vercel project.

The API must also list `https://storage.denizlg24.com` as a trusted browser
origin (`CLOUD_AUTH_TRUSTED_ORIGINS` in `apps/api/src/auth/better-auth.ts`), or
sign-in, uploads and every API call will fail CORS. Preview deployments get
generated `*.vercel.app` origins that are **not** on that list, so API-backed
flows only work against the production domain unless the preview origin is
added.

## Vercel project settings

For each project:

1. Import the GitHub repository and select the Next.js framework preset.
2. Set the root directory shown above and keep access to files outside the
   root directory enabled so Bun can resolve the root lockfile and
   `@repo/ui`.
3. Use Bun with install command `bun install --frozen-lockfile`.
4. Keep build command `bun run build` and output directory `.next`.
5. Add the environment variables listed above to the matching project. Use
   `https://api.denizlg24.com` even before the API is deployed; this is enough
   for the Next.js build and keeps the eventual URL stable.
6. Attach the listed domain to the project, but leave the existing DNS target
   unchanged. Plan 012 owns the DNS switch.
7. Leave GitHub preview deployments enabled for pull requests.

Before the DNS switch, verify both generated `*.vercel.app` production URLs
and a pull-request preview. The pages can be checked before the API exists,
but API-backed routes and login will not work until the API is deployed. Once
the API is live, redeploy both projects after confirming its URL, and verify
the API trusts `https://cloud.denizlg24.com` and `https://storage.denizlg24.com`
as browser origins.

Storage is the only one of the two that non-superusers reach, so smoke it with
a normal account: sign in, upload a file, open a preview, create a share link
and open that link in a private window.
