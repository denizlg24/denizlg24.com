# denizlg24.com

[![CI](https://github.com/denizlg24/denizlg24.com/actions/workflows/ci.yml/badge.svg)](https://github.com/denizlg24/denizlg24.com/actions/workflows/ci.yml)

The monorepo behind [denizlg24.com](https://denizlg24.com) and its companion
desktop life dashboard.

The public website presents projects, writing, and current work. Its
authenticated admin API powers a Tauri desktop application for managing notes,
people, calendar events, email, projects, resources, kanban boards, and other
personal workflows.

## Structure

| Path | Purpose |
| --- | --- |
| `apps/web` | Next.js public website, admin dashboard, and API |
| `apps/desktop` | Next.js dashboard packaged with Tauri |
| `packages/schemas` | Canonical Zod API contracts shared by both apps |
| `packages/ui` | Shared React UI components |
| `packages/utils` | Shared utilities |
| `packages/typescript-config` | Shared TypeScript configuration |
| `plans` | Implementation plans and completed engineering work |

## Stack

- Bun workspaces and Turborepo
- Next.js 16, React 19, and TypeScript
- Tauri 2 for the desktop application
- Tailwind CSS, Radix UI, and shared `@repo/ui` components
- MongoDB and Mongoose
- Zod contracts shared through `@repo/schemas`
- Biome, Bun Test, and GitHub Actions

## Development

Requirements:

- [Bun](https://bun.sh/) 1.3+
- Node.js 18+
- Rust and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
  when running the desktop shell
- A local root `.env` containing the services and credentials used by the
  features you intend to run

Install dependencies:

```bash
bun install
```

Run the web and desktop development servers through Turborepo:

```bash
bun run dev
```

Run an individual app:

```bash
bunx turbo dev --filter=web
bun --cwd apps/desktop run dev:server
bun --cwd apps/desktop run dev
```

The desktop Next.js server runs on `http://localhost:3001`. The Tauri command
starts that server and opens the native shell.

## Verification

```bash
bunx turbo typecheck
bun --env-file=.env turbo run test
bun run format-and-lint
bun run build
```

CI runs builds, typechecks, tests, and Biome checks for every pull request and
push to `main`.

## Architecture

The web app owns persistence, authentication, public pages, and the admin API.
The desktop app consumes that API using the contracts in `@repo/schemas`.
Browser and Tauri platform adapters keep the desktop UI runnable in both a
normal browser and the native shell.

Shared UI primitives live in `@repo/ui`; application-specific navigation,
authentication, and platform integrations remain inside their respective apps.

## Deployment

- `apps/web` is deployed as the website and API.
- `apps/desktop` is statically exported and bundled by Tauri.
- `.github/workflows/release-desktop.yml` builds desktop releases.

This repository contains personal infrastructure and application code. Running
every feature locally requires your own external services and credentials.
