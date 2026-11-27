<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# apps/desktop

Tauri + Next.js 16 static export (`output: "export"`). Each route under
`app/dashboard/*` is a shim over a `packages/admin` feature — read
`packages/admin/AGENTS.md` for routing, UI and workspace rules.

- **Sign-in is an OAuth public client; config comes from web, not the
  build** (`GET /api/public/desktop-auth`). Tokens live in `auth.json` under
  plugin-store; refresh is single-flight in `lib/auth/session.ts`. Gate UI on
  `useAuthStore` (`status === "signed-in"`), never on a stored credential.
- `lib/api-wrapper.ts` (`denizApi`) is the direct client for desktop-only
  code; base URL from `NEXT_PUBLIC_DESKTOP_API_BASE_URL`. Errors are a union
  — check `"code" in result`.
- Device settings and release notes are desktop-owned routes handed to the
  shared settings shell through `slots.settingsExtraSections`, because they
  need Tauri APIs and the build-time `CHANGELOG.md`.
