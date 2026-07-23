# Vercel projects

Create two Vercel projects from `denizlg24/denizlg24.com`. Do not change the
current production DNS during plan 011.

| Project | Root directory | Production domain |
|---|---|---|
| `deniz-cloud` | `apps/cloud` | `cloud.denizlg24.com` |
| `deniz-storage` | `apps/storage` | `storage.denizlg24.com` |

For each project:

1. Import the GitHub repository and select the Next.js framework preset.
2. Set the root directory shown above and keep access to files outside the
   root directory enabled so Bun can resolve the root lockfile and
   `@repo/ui`.
3. Use Bun with install command `bun install --frozen-lockfile`.
4. Keep build command `bun run build` and output directory `.next`.
5. Add `NEXT_PUBLIC_CLOUD_API_URL=https://api.denizlg24.com` to Production,
   Preview, and Development environments.
6. Attach the listed domain to the project, but leave the existing DNS target
   unchanged. Plan 012 owns the DNS switch.
7. Leave GitHub preview deployments enabled for pull requests.

Before the DNS switch, verify both generated `*.vercel.app` production URLs
and a pull-request preview. Browser requests must target
`https://api.denizlg24.com`; do not add production secrets to either
client-side Next.js project.
