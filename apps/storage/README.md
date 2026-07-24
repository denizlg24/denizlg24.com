# storage

The file browser at `storage.denizlg24.com`. Unlike `apps/cloud`, this app
serves every account, not just the superuser — signup completion and TOTP
enrollment happen here.

## Running it

```bash
bunx turbo dev --filter=storage   # :3005, expects apps/api on :3001
```

`NEXT_PUBLIC_CLOUD_API_URL` and `NEXT_PUBLIC_STORAGE_APP_URL` come from the
root `.env`. Both fall back to localhost so a build missing its Vercel
variables fails loudly instead of pointing at production.

## Layout

- `lib/api.ts` — the only place that talks to the API. Every response is
  parsed with a `@repo/schemas/cloud` schema; nothing else should call `fetch`
  against the API.
- `lib/store.ts` — per-folder cache behind `useSyncExternalStore`, plus the
  mutations that keep it consistent. Deletes are deferred here so the undo
  toast can cancel them before anything leaves the browser.
- `lib/uploads.ts` — TUS queue (3 parallel, pause/resume/retry), directory
  expansion for folder drops, and the folder resolution shared across jobs.
- `components/file-preview.tsx` — renderers shared by the in-app preview and
  the public share page, so both stay in sync.
- `app/(app)/folders/[id]/` — the browser. `_components/browser.tsx` owns
  selection, keyboard handling and drag-drop; the rest are leaves.

## Verifying against real infra

```bash
cd apps/api && bun --env-file=../../.env scripts/storage-app-e2e.ts
```

Creates a throwaway user, completes signup, enrolls TOTP, then exercises
folders, a deliberately interrupted TUS upload, Range streaming, share links,
bulk ZIP, the concurrent-create race and recursive delete — then deletes the
user. Needs the dev API and infra up.
