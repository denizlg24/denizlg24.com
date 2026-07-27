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
| `apps/envoy` | Envoy CLI public site and Hono/Prisma API |
| `apps/envoy-cli` | Rust Envoy CLI and release-mirror source |
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

Run a focused development stack:

```bash
bun run dev:web
bun run dev:desktop
bun run dev:cloud
bun run dev:storage
bun run dev:envoy
cd apps/envoy-cli && cargo run -- --help
```

`dev:desktop` starts the web app plus the Tauri desktop app; Tauri manages its
own Next.js server on `http://localhost:3004`. The cloud and storage commands
also start the shared API on `http://localhost:3001`.

## Verification

```bash
bunx turbo typecheck
bun --env-file=.env turbo run test
bun run format-and-lint
bun run build
cd apps/envoy-cli
cargo fmt --check
cargo test --all-targets --locked
cargo clippy --all-targets --locked -- -D warnings
```

CI runs builds, typechecks, tests, and Biome checks for every pull request and
push to `main`. A separate CI job applies Rust formatting, tests, and Clippy to
`apps/envoy-cli`.

## Architecture

The web app owns persistence, authentication, public pages, and the admin API.
The desktop app consumes that API using the contracts in `@repo/schemas`.
Browser and Tauri platform adapters keep the desktop UI runnable in both a
normal browser and the native shell.

Shared UI primitives live in `@repo/ui`; application-specific navigation,
authentication, and platform integrations remain inside their respective apps.
Envoy request and response schemas live in `@repo/schemas/envoy`. The Rust CLI
and TypeScript server both validate the versioned fixtures in
`apps/envoy-cli/contracts`.

## Deployment

- `apps/web` is deployed as the website and API.
- `apps/envoy` is deployed as the Envoy site and API, with blobs stored in the
  project-scoped denizlg24 cloud S3 bucket. Its Vercel project uses
  `apps/envoy` as the Root Directory and includes source files outside that
  directory so workspace contracts and UI packages are available.
- `apps/envoy-cli` is developed here and mirrored to
  [`denizlg24/envoy`](https://github.com/denizlg24/envoy), where the existing
  CLI release workflow publishes installers and update assets. There is no
  separate CLI release deployment from this monorepo.
- `apps/desktop` is statically exported and bundled by Tauri.
- `.github/workflows/release-desktop.yml` builds desktop releases.
- `.github/workflows/sync-envoy-cli.yml` pushes the CLI subtree to its release
  mirror after changes land on `main`. It requires an `ENVOY_REPO_TOKEN`
  fine-grained secret with contents write access to `denizlg24/envoy`.

To sync manually, preserving the same subtree history:

```bash
git subtree push \
  --prefix=apps/envoy-cli \
  https://github.com/denizlg24/envoy.git \
  master
```

Create and push CLI `v*` tags in the release mirror after the sync; its
standalone release workflow remains responsible for cross-platform binaries.

This repository contains personal infrastructure and application code. Running
every feature locally requires your own external services and credentials.
