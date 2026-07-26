# Vercel projects

Two projects build from `denizlg24/denizlg24.com`, both live.

| Project | Root directory | Domain |
|---|---|---|
| `cloud-denizlg24` | `apps/cloud` | `cloud.denizlg24.com` |
| `storage-denizlg24` | `apps/storage` | `storage.denizlg24.com` |

## Environment variables

Set on **Production**, **Preview** and **Development**. All are
`NEXT_PUBLIC_*`, so they are inlined at build time and must exist *before* a
deployment — the in-code fallbacks are `localhost`, never production, so a
build that forgets one is visibly broken rather than quietly pointing at live
data.

`cloud-denizlg24`:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_CLOUD_API_URL` | `https://api.denizlg24.com` |
| `NEXT_PUBLIC_STORAGE_APP_URL` | `https://storage.denizlg24.com` |
| `NEXT_PUBLIC_DISK_BAY_COUNT` | `8` (physical bays; discovered disks are added if too small) |

`storage-denizlg24`:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_CLOUD_API_URL` | `https://api.denizlg24.com` |
| `NEXT_PUBLIC_STORAGE_APP_URL` | `https://storage.denizlg24.com` |

`NEXT_PUBLIC_STORAGE_APP_URL` must match the domain users actually visit and be
identical in both projects: share links are built from it, and the admin app
deep-links into `/folders/:id`.

Neither project has database or secret access. `DATABASE_URL`,
`BETTER_AUTH_SECRET`, `JWT_SECRET`, S3 and terminal secrets all belong to the
self-hosted `apps/api`.

## CORS

The API must list both domains in `CLOUD_AUTH_TRUSTED_ORIGINS`
(`apps/api/src/auth/better-auth.ts`) or sign-in and every API call fails CORS.
Preview deployments get generated `*.vercel.app` origins that are **not** on
that list, so API-backed flows only work against the production domains unless
a preview origin is added deliberately.

## Project settings

Next.js preset, root directory as above, access to files outside the root
enabled so Bun resolves the root lockfile and `@repo/ui`. Install
`bun install --frozen-lockfile`, build `bun run build`, output `.next`. Preview
deployments stay enabled for pull requests.

## Smoke

Storage is the only one non-superusers reach: sign in, upload, open a preview,
create a share link, open it in a private window.
