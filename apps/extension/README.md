# Authenticator extension

Offline-first TOTP codes for Chrome and Firefox, synced with
`/api/admin/authenticator` on denizlg24.com.

## How it works

Secrets are pulled once from `GET /api/admin/authenticator/export`, sealed with
AES-256-GCM under a key derived from a passphrase (PBKDF2-SHA256, 600k
iterations), and kept in `storage.local`. Codes are generated locally, so the
extension keeps working when the server does not — that is the point of holding
a copy rather than polling for codes.

The unlocked key lives in `storage.session` (memory only, extension contexts
only), which is what lets the background worker sync without a second unlock and
what makes a browser restart lock the vault again.

Sync runs when the popup opens, after every local change, and on a timer. Local
changes are pushed before the pull, so the merge never has to arbitrate. Accounts
deleted on the server move to a local trash and are purged after the retention
window rather than being dropped on the spot.

## Commands

```bash
bun run dev              # chrome, watch mode
bun run dev:firefox
bun run build            # both targets into dist/
bun run package          # release/*.zip, store-ready
bun run icons            # regenerate public/icons from scripts/generate-icons.ts
bun test
bun run typecheck
```

`EXT_API_BASE_URL` (or `--api-base-url=`) overrides the compiled-in default and
the manifest's `host_permissions` entry.

## Loading a development build

- Chrome: `chrome://extensions` → Developer mode → Load unpacked → `dist/chrome`
- Firefox: `about:debugging#/runtime/this-firefox` → Load Temporary Add-on →
  `dist/firefox/manifest.json`

## Releasing

Bump `version` in `package.json` and merge to `main`. `release-extension.yml`
detects the change, builds both targets plus the source archive, and publishes a
GitHub release tagged `ext-v<version>`. Uploading to the two stores is manual.
