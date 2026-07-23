# Cloud 001: Workspace foundation — submodule, scaffolds, turbo wiring, CI skeleton

> **Executor instructions**: Follow step by step. Run every verification
> command. On STOP conditions, stop and report. When done, update
> `plans/cloud/README.md`.

## Status

- **Executor**: opus 4.8
- **Effort**: M
- **Risk**: LOW (additive only; no existing app touched beyond turbo/CI config)
- **Depends on**: —
- **Category**: scaffolding / DX

## Why

Everything downstream needs: the old source readable in-repo, the three new
workspaces existing and green in `turbo typecheck`/`build`, and CI aware of
them. This plan creates empty-but-running skeletons only — no feature code.

## Current state (verified 2026-07-23)

- This monorepo: bun workspaces `apps/*`, `packages/*`; turbo tasks `build`,
  `typecheck`, `test`, `lint`, `dev`; Biome at root; CI in
  `.github/workflows/ci.yml` runs `bunx turbo build|typecheck|test` + Biome
  with a mongo:8 service and placeholder env.
- Old repo: `E:\PersonalProjects\deniz-cloud` — bun workspaces
  `packages/{shared,storage-api,storage-ui,admin-api,admin-ui,terminal-server}`,
  Hono APIs, Vite SPAs, 47 test files, own biome config.

## Scope

### 1. Add the submodule

```
git submodule add https://github.com/denizlg24/deniz-cloud vendor/deniz-cloud
```

(If the remote URL differs, read it from `E:\PersonalProjects\deniz-cloud`
`.git/config` — STOP only if there is no remote at all.) Pin to current
`main`. Ensure `vendor/` is NOT matched by any workspace glob (root
`package.json` lists `apps/*`, `packages/*` — verify unchanged) so bun never
installs its dependencies. Add a `vendor/README.md` one-liner: read-only
reference for the cloud rewrite, removed by plan 013. Confirm `bun install`
and `bunx turbo typecheck` still pass and ignore the submodule.

### 2. Scaffold `apps/api` (Bun + Hono — runs on the Pi)

Scaffold-first per repo convention, but there is no official Hono+bun turbo
generator that matches; use `bun create hono@latest apps/api` (template:
`bun`). Then align: `name: "api"`, scripts `dev` (`bun run --watch
src/index.ts`), `build` (`bun build src/index.ts --outdir dist --target bun`),
`typecheck` (`tsc --noEmit`), `test` (`bun test`); extend
`@repo/typescript-config` like other packages; add a `/healthz` route
returning `{ status: "ok", version }` and one `bun:test` for it.

### 3. Scaffold `apps/cloud` and `apps/storage` (Next.js — Vercel)

`bunx create-next-app@latest` (App Router, TS, Tailwind — accept current
defaults, mirror choices already visible in `apps/web`). Wire each into
workspaces with `@repo/typescript-config`, `@repo/ui` (add as dependency and
render one `@repo/ui` component on the placeholder home page to prove the
transpile path works — copy the `transpilePackages`/config approach from
`apps/web/next.config.*`), Biome instead of the scaffold's ESLint (delete
eslint config + dep, as done in existing apps). Placeholder pages only:
"cloud admin — under construction" / "storage — under construction".

### 4. Scaffold `packages/cloud-core`

Empty library package `@repo/cloud-core` (mirror `packages/utils` layout:
`src/index.ts`, tsconfig extending the shared preset, `typecheck` + `test`
scripts). Plan 002 fills it. It will hold Pi-side code (Drizzle schema,
services, middleware) shared between `apps/api` and migration scripts — it
must never be imported by the Vercel apps (client contracts go in
`packages/schemas` — see plan 002).

### 5. Turbo + CI wiring

- Verify new workspaces are picked up (`bunx turbo run typecheck` lists them).
- Add any new env var names used by scaffolds to `turbo.json` `env` (likely
  none yet).
- CI: no new workflow yet (plan 011 owns deploy). Confirm existing `ci.yml`
  covers the new workspaces automatically via `bunx turbo build` at root.
  Add `apps/api`-needed placeholder env to `ci.yml` only if its build fails
  without it (record what you add).

### 6. Dev harness

Create `infra/compose/docker-compose.dev.yml` providing dev dependencies for
later plans: postgres:16, mongo:8 (single-node replica set — copy the
keyfile/rs-init approach from `vendor/deniz-cloud/docker-compose.local.yml`
and `scripts/infra/mongo-rs-init.sh`), redis:7-alpine (password), meilisearch
(master key). Dev-only creds via `infra/compose/.env.dev.example` (commit the
example, gitignore `.env.dev`). Do NOT wire app containers — dev runs apps
with `bun --watch` against these services. Add root script
`"cloud:dev:infra": "docker compose -f infra/compose/docker-compose.dev.yml up -d"`.
Verify all four containers become healthy locally, then `docker compose ...
down`.

## Verification (all must pass)

```
bun install                     # exit 0, no submodule deps installed
bunx turbo build                # all workspaces incl. api/cloud/storage
bunx turbo typecheck
bunx turbo test                 # api healthz test passes
bun run format-and-lint         # Biome clean on new files
git submodule status            # vendor/deniz-cloud pinned
docker compose -f infra/compose/docker-compose.dev.yml up -d && docker ps  # 4 healthy
```

## Out of scope

Any feature code, auth, deploy workflows, Vercel project creation (011/012),
touching `apps/web`/`apps/desktop`.

## STOP conditions

Runbook STOPs, plus: scaffold generators emit structures conflicting with
monorepo conventions in ways you can't align with <10 lines of config; the
mongo replica-set dev container can't reach healthy after copying the old
repo's init approach.

## Drift log

Executed 2026-07-23 (opus 4.8). All verification commands pass. Deviations:

1. **Next-app tsconfig**: `apps/cloud` and `apps/storage` keep the standalone
   `create-next-app` tsconfig, mirroring `apps/web` (which does not extend
   `@repo/typescript-config`). The plan's "wire in `@repo/typescript-config`" is
   reconciled to the existing app's actual pattern. `@repo/ui` is wired as a
   workspace dependency + `transpilePackages: ["@repo/ui"]` + a rendered `Button`
   on each placeholder page (proves the transpile path). `globals.css` gains
   `@source "../../../packages/ui/src"`.
2. **`cloud:dev:infra` script** uses `docker compose --env-file infra/compose/.env.dev
   -f infra/compose/docker-compose.dev.yml up -d` — the plan text omitted
   `--env-file`, but the named `.env.dev` (not `.env`) is not auto-loaded without
   it. Added a companion `cloud:dev:infra:down` script.
3. **Mongo dev harness** diverges from the old repo's host-bind-mounted keyfile:
   the keyfile is generated **inside the container** (`openssl rand`, chmod 400,
   chown 999) and data uses **named volumes**, to avoid Windows/macOS bind-mount
   permission failures. Single-node replica set `rs0` with root auth;
   `mongo-init` one-shot runs `rs.initiate`. Host clients must connect with
   `directConnection=true` (member host `mongodb:27017` only resolves inside the
   compose network). `mongot`/Meilisearch-sync and per-project Redis ACLs from the
   old compose are intentionally out of scope here (owned by 004/005/006/011).
4. **Biome**: `biome.json` `files.includes` gains `!vendor` so Biome ignores the
   submodule, which ships its own `biome.json` (otherwise a nested-root error).
5. **turbo.json** `build.outputs` gains `dist/**` so `apps/api`'s `bun build`
   output is cached.
6. **No `test` script** on `apps/cloud`/`apps/storage` yet (no tests until
   008/009; `bun test` exits 1 on zero test files). `@repo/cloud-core` has a smoke
   test so its `test` script passes.
7. **CI** (`ci.yml`) unchanged — `apps/api` builds with no env; the new
   workspaces are covered by the root `bunx turbo build`. No placeholder env
   needed. (A full local `bunx turbo build` still needs the root `.env` for
   web/desktop — pre-existing.)
