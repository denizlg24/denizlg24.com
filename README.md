# denizlg24.com

[![CI](https://github.com/denizlg24/denizlg24.com/actions/workflows/ci.yml/badge.svg)](https://github.com/denizlg24/denizlg24.com/actions/workflows/ci.yml)

This is the monorepo behind [denizlg24.com](https://denizlg24.com), my public
website, personal applications, and self-hosted infrastructure.

Most applications here are purpose-built for my own workflows. The two public
projects are Envoy and its Rust CLI.

## Public projects

### Envoy

[Envoy](https://envoy.denizlg24.com) is encrypted, Git-style version control
for environment files. It stores encrypted blobs and commit history while
keeping plaintext secrets and encryption keys on the user's machine.

- [Envoy service source](apps/envoy)
- [Envoy CLI source and documentation](apps/envoy-cli)
- [Envoy CLI on crates.io](https://crates.io/crates/envoy-cli)

## Repository map

### Applications

| Path | Description | Audience |
| --- | --- | --- |
| `apps/web` | Public website, writing, projects, and private administration | Personal |
| `apps/desktop` | Native life-dashboard client built with Tauri | Personal |
| `apps/authenticator-extension` | Chrome and Firefox extension holding an offline authenticator vault | Personal |
| `apps/api` | API for my self-hosted cloud | Personal |
| `apps/cloud` | Administration interface for cloud services | Personal |
| `apps/email-classifier` | Python Logistic Regression Email Classifier API | Personal |
| `apps/markets-relay` | Bun WebSocket relay fanning out Tiingo market quotes | Personal |
| `apps/storage` | Browser-based file manager | Personal |
| `apps/terminal` | Web-terminal daemon for the cloud host | Personal |
| `apps/envoy` | Envoy website and encrypted-storage API | Public |
| `apps/envoy-cli` | Rust command-line client for Envoy | Public |
| `apps/ssh-server` | Go based ssh-server that powers my business card | Personal |
| `infra/*` | Deployment definitions for self-hosted services | Personal |

### Packages

| Path | Description |
| --- | --- |
| `packages/schemas` | Canonical wire contracts as Zod schemas; every application type is inferred from here |
| `packages/ui` | Design system and component library shared by every browser interface |
| `packages/admin` | Shared administration feature screens rendered by both the website and the desktop client |
| `packages/markets` | Portfolio engine, pricing logic, and market data contracts |
| `packages/latex-editor` | Reusable multi-file LaTeX editing workspace with compile log and preview |
| `packages/whiteboard-render` | Server-side rendering of whiteboard documents to SVG |
| `packages/cloud-core` | Self-hosted cloud logic: database schema, S3 storage, projects, operations, sync |
| `packages/cloud-ui` | Shared interface pieces for the cloud and storage applications |
| `packages/cloud-auth-client` | Client-side authentication for the cloud applications |
| `packages/utils` | Shared helpers for money, recurrence, and tree structures |
| `packages/typescript-config` | Shared TypeScript configuration presets |

## Architecture

The TypeScript applications are organized as Bun workspaces and coordinated by
Turborepo. Next.js and React power the browser interfaces, Tauri packages the
desktop application, and shared packages keep contracts and UI consistent
across applications.

The self-hosted cloud runs a Bun and Hono API backed by PostgreSQL, MongoDB,
Redis, and S3-compatible storage. Envoy combines a Next.js service with a Rust
CLI and shares versioned API fixtures across both implementations.

## Technology

- Bun, TypeScript, Turborepo
- Next.js, React, Tailwind CSS
- Vite and Manifest V3 for the browser extension
- Rust and Tauri
- Go, Python, FastAPI
- Hono, PostgreSQL, MongoDB, Redis
- Prisma and Drizzle
- Docker, GitHub Actions, Vercel

This repository is public for transparency and as a record of the systems I
build and operate. Personal applications are tailored to my environment and
are not presented as reusable products.
