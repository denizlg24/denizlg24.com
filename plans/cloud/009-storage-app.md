# Cloud 009: `apps/storage` — the file browser app (storage.denizlg24.com)

> **Executor instructions**: Follow step by step. Run every verification
> command. On STOP conditions, stop and report. When done, update
> `plans/cloud/README.md`.

## Status

- **Executor**: fable 5
- **Effort**: XL
- **Risk**: MED
- **Depends on**: 003, 004
- **Category**: full-stack UI

## Why

Replaces `vendor/deniz-cloud/packages/storage-ui` (Vite SPA: file browser
grid/list, folder nav, TUS upload w/ drag-drop, previews for
image/video/audio/pdf/code/text/markdown, share dialog, signup/MFA flows).
Next.js on Vercel at `storage.denizlg24.com`, against `api.denizlg24.com`.
Same design direction as 008: editorial, not cardy; reuse `@repo/ui`;
phone-usable.

## Auth & data conventions

Same as plan 008 (§Auth & data conventions): better-auth client,
cross-subdomain cookies, single zod-validated `lib/api.ts`, no untyped fetch.
This app serves ALL users (not superuser-only). Signup-completion and
MFA-enrollment flows live HERE (pending users complete signup on storage —
old behavior preserved; better-auth flow from plan 003).

## Scope

1. **Auth screens** — login (+TOTP, recovery), complete-signup (email,
   password, mandatory TOTP enrollment with QR + confirm), forced
   `/setup-mfa` redirect when session lacks TOTP (port old guard behavior).
2. **Browser** — folder tree/breadcrumbs, grid + list views (density
   toggle), multi-select, keyboard nav (arrows, enter, del, F2), create/
   rename/move/delete dialogs, drag-drop move, **multi-select bulk download
   (NEW — 004's streaming ZIP endpoint; progress via streamed download,
   friendly error when over the size cap)**, tier badge (ssd/hdd) subtle,
   per-folder cache with invalidation on mutation (old app cached folders —
   keep the UX snappiness; TanStack Query is the monorepo-consistent
   choice).
3. **Upload** — TUS resumable (tus-js-client) with drag-drop target,
   parallel queue, per-file progress, pause/resume, failure retry; folder
   upload if the old UI had it (check `storage-ui` — if absent, skip; note).
4. **Previews** — image (zoom), video/audio (Range streaming), PDF, code w/
   syntax highlight, text, markdown render. Reuse monorepo renderers where
   they exist (`packages/`, apps/web markdown pipeline) instead of new deps
   where practical.
5. **Sharing** — share dialog (expiry presets 30m/1d/7d/30d/never), copy
   link, public share landing page (`/s/[token]`) that streams/previews
   without auth via 004's share endpoints. The public page must be
   fast/minimal and not leak anything beyond the shared file.
6. **Search** — storage search UI against `/api/search` (004).
7. **Account** — password change, TOTP re-enroll, backup codes (shared
   pattern with 008 — build independently here; 010 consolidates).

Backend gaps: same rule as 008 — fix in `apps/api`+schemas in-session,
record in Drift log.

## Verification

```
bunx turbo typecheck --filter=storage --filter=api
bunx turbo test --filter=storage --filter=api
bunx turbo build --filter=storage
bun run format-and-lint
# manual e2e vs dev infra+api: complete-signup w/ TOTP → upload 100MB file
# with an interruption mid-way → resumes → preview video (seek works =
# Range OK) → share link opens in incognito → expires correctly (short
# custom expiry for test). Responsive pass 375/768/1280.
```

## STOP conditions

Runbook STOPs, plus: TUS resume or Range streaming fails against 004's API
(backend contract bug — coordinate via Drift log + report, don't paper over
in the client).

## Drift log

- **From 004 (2026-07-23):** The consolidated endpoints are
  `/api/storage/*`, `/api/search`, and `/v2`; canonical storage response
  schemas are exported from `@repo/schemas/cloud`. TUS requires and exposes
  the standard `Tus-Resumable`, `Upload-*`, and `Location` headers. Bulk ZIP
  selection is capped by `STORAGE_ARCHIVE_MAX_BYTES` (2 GiB default, ZIP32
  maximum 4095 MiB), with `ARCHIVE_TOO_LARGE`/413 surfaced to the UI.
