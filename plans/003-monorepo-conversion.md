# Plan 003: Convert to a Turborepo monorepo (scaffold-first, bun, apps/web + apps/desktop)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Operator decisions baked into this plan** (do not re-litigate): Turborepo
> (for Vercel deployment + remote caching); scaffold with REAL generators
> (`bunx create-turbo@latest`, `bunx create-next-app@latest`) and port code
> into the scaffolds — never hand-author a package.json from scratch; install
> dependencies with `bun add` (no version pins = latest); apps named `web`
> (portfolio) and `desktop` (Tauri client); scope is these two apps only.
>
> **Drift check (run first)**: confirm `git -C portfolio-2026 rev-parse --short HEAD`
> and `git -C denizlg24-app rev-parse --short HEAD` resolve, and that
> `E:\PersonalProjects\denizlg24.com` is NOT a git repo
> (`git -C E:\PersonalProjects\denizlg24.com rev-parse` → error). If the root
> is already a git repo or an `apps/` directory already exists, STOP.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED-HIGH (full code port onto fresh scaffolds with latest deps; mitigated by archiving originals untouched and gating every step on typecheck/build)
- **Depends on**: plans/001-verification-baseline.md, plans/002-public-endpoint-hardening.md (land code fixes before the port)
- **Category**: migration
- **Planned at**: portfolio-2026 @ `b1fe917`, denizlg24-app @ `e790966`, 2026-06-11

## Why this matters

The two apps are one product (portfolio-2026 = backend/API + public site;
denizlg24-app = Tauri desktop client of that API) living in two unrelated git
repos with hand-duplicated API types and drifting dependency versions (next
16.2.6 vs 16.1.6, react 19.2.6 vs 19.2.3). A Turborepo workspace gives:
shared internal packages (plan 004 adds zod schemas both sides consume),
task-graph builds with caching, and zero-config Vercel deployment with Remote
Caching. Scaffold-first (generators, not hand-written manifests) is an
explicit operator requirement — hand-rolled package.json/turbo.json files are
where these conversions usually break.

**Accepted trade-off (operator-approved approach implies it):** the new root
repo starts with fresh history. The original repos are preserved intact under
`_archive/` (each keeps its `.git`), so history remains consultable there.

## Current state

Root `E:\PersonalProjects\denizlg24.com` — NOT a git repo. Contents:

```
CLAUDE.md, plans/, semantic-*.md     (keep at root, track in new repo)
portfolio-2026/                      (git repo; Next.js App Router; MongoDB/mongoose,
                                      better-auth, IMAP email, Resend, Anthropic SDK;
                                      dirs: app/ components/ hooks/ lib/ models/ public/
                                      scripts/ types/ + proxy.ts, biome.json,
                                      components.json, next.config.ts, postcss.config.mjs)
denizlg24-app/                       (git repo; Tauri 2 + Next static export
                                      ("output: export" → out/); dirs: app/ components/
                                      context/ hooks/ lib/ public/ stores/ src-tauri/
                                      + biome.json, components.json, next.config.ts,
                                      postcss.config.mjs)
bookmark-extension/, deniz-nutrition-api/, macros/   (OUT of scope — gitignore)
```

- Package manager: **bun** in both. Lint/format: **Biome** (no ESLint
  anywhere — the turbo scaffold's ESLint packages get removed).
- Both apps' `.env*` files are gitignored — they must be copied into the new
  app dirs by hand (Step 8).
- Plans 001/002 added `typecheck`/`test` scripts and security fixes — the port
  must carry those over (they're in the source trees being copied).

Target layout (Turborepo conventions):

```
E:\PersonalProjects\denizlg24.com\
  package.json            (scaffolded root; workspaces; turbo devDep)
  turbo.json              (scaffolded; tasks adapted in Step 6)
  bun.lock                (single root lockfile)
  biome.json              (root task per turbo Biome guide)
  apps/web/               (create-next-app scaffold + ported portfolio-2026 code)
  apps/desktop/           (create-next-app scaffold + ported denizlg24-app code + src-tauri/)
  packages/typescript-config/   (kept from create-turbo scaffold)
  plans/, CLAUDE.md, docs/
  _archive/               (originals, gitignored)
```

## Commands you will need

| Purpose | Command (repo root) | Expected on success |
|---------|---------------------|---------------------|
| Scaffold monorepo | `bunx create-turbo@latest <dir> -m bun --skip-install` | exit 0, dir created |
| Scaffold app | `bunx create-next-app@latest apps/<name> --ts --tailwind --app --no-eslint --no-src-dir --import-alias "@/*" --skip-install --yes` | exit 0 |
| Install | `bun install` | exit 0, root `bun.lock` |
| Add deps to one app | `bun add <pkgs...>` / `bun add -d <pkgs...>` run INSIDE the app dir | exit 0 |
| All tasks | `bunx turbo build` / `bunx turbo typecheck` / `bunx turbo test` | exit 0 per package |
| Lint (root task) | `bun run format-and-lint` | exit 0 |

(If `create-next-app` rejects a flag, run `bunx create-next-app@latest --help`
and use the current equivalents — flags drift between majors; the intent of
each flag is listed in Step 4.)

## Scope

**In scope**: everything under the target layout above; copying source
directories from the originals; `bun add` dependency installation; minimal
mechanical adaptations listed in Steps 5–7 (package names, turbo.json tasks,
Biome root task, tauri.conf.json path check).

**Out of scope** (do NOT touch):
- Source-code logic changes of any kind — this is a structural port. If a
  latest-version dependency breaks compilation, see STOP conditions; do not
  rewrite app code beyond what a documented breaking-change migration
  requires (and record every such change in the report).
- `bookmark-extension/`, `deniz-nutrition-api/`, `macros/` — gitignored,
  untouched.
- Shared packages with real code (plan 004), CI (plan 006), responsive work
  (plan 005).
- The originals once archived — `_archive/` is read-only rollback material.

## Git workflow

- The scaffold's `git init` repo becomes the canonical repo (branch `main`).
- Commit after each numbered step (`Scaffold turborepo root`,
  `Port portfolio-2026 into apps/web`, ...). Do NOT push (plan 006 sets up
  GitHub).

## Steps

### Step 0: Preconditions

1. `git -C portfolio-2026 status --porcelain` → empty (else STOP).
2. `git -C denizlg24-app status --porcelain` → empty (else STOP).
3. `bun --version` → ≥1.3.

### Step 1: Archive the originals

```
mkdir _archive
```

Move `portfolio-2026/` and `denizlg24-app/` into `_archive\` (PowerShell
`Move-Item`). They keep their `.git` dirs — this is the rollback path and the
history archive.

**Verify**: `ls _archive` → both present; root no longer contains them.

### Step 2: Scaffold the Turborepo and hoist it to the root

```
bunx create-turbo@latest scaffold-tmp -m bun --skip-install
```

Then move EVERYTHING from `scaffold-tmp\` (including dotfiles: `.gitignore`,
`.git` if created, `.vscode`, etc.) into the root
`E:\PersonalProjects\denizlg24.com\`, and remove the empty `scaffold-tmp`.
If create-turbo did not `git init` (it may skip when nested), run `git init -b main`
at root now.

Append to the root `.gitignore`:

```
# local secrets
.env
.env.*
!.env.example
# not part of this monorepo
bookmark-extension/
deniz-nutrition-api/
macros/
_archive/
# tauri
apps/desktop/src-tauri/target/
```

**Verify**: root has `package.json` with `"workspaces"`, `turbo.json`,
`apps/`, `packages/`; `git -C . rev-parse` → succeeds.

### Step 3: Strip what we don't use from the scaffold

The basic starter ships `apps/web`, `apps/docs`, `packages/ui`,
`packages/eslint-config`, `packages/typescript-config` and uses ESLint.

1. Delete `apps/web`, `apps/docs`, `packages/ui`, `packages/eslint-config`
   (we use Biome; fresh apps come in Step 4; a real ui package is plan 005's
   follow-up). KEEP `packages/typescript-config`.
2. Remove eslint/prettier-related devDependencies from the ROOT package.json
   only if present — via `bun remove <name>` (after Step 4's first
   `bun install`), never by hand-editing.
3. Set up Biome as a root task per the Turborepo Biome guide
   (https://turborepo.dev/docs/guides/tools/biome): copy
   `_archive/portfolio-2026/biome.json` to the root as `biome.json`, add root
   scripts via the scaffold root package.json:
   `"format-and-lint": "biome check ."` and
   `"format-and-lint:fix": "biome check . --write"` (these two script lines
   are the one permitted manual package.json edit — they are scripts, not
   dependency manifests), and register in `turbo.json`:

```json
"tasks": {
  "//#format-and-lint": {},
  "//#format-and-lint:fix": { "cache": false }
}
```

   (merge into the existing `tasks` object, keep scaffolded tasks).
4. `bun add -d @biomejs/biome` at root. `bun add -d turbo` at root if the
   scaffold didn't already pin it.

**Verify**: `bun install` → exit 0. `bun run format-and-lint` → runs Biome
(findings are fine; command must execute).

### Step 4: Scaffold the two apps with create-next-app

From the root:

```
bunx create-next-app@latest apps/web --ts --tailwind --app --no-eslint --no-src-dir --import-alias "@/*" --skip-install --yes
bunx create-next-app@latest apps/desktop --ts --tailwind --app --no-eslint --no-src-dir --import-alias "@/*" --skip-install --yes
```

Flag intent (adapt if flags renamed): TypeScript, Tailwind, App Router, no
ESLint, no `src/` dir, `@/*` alias, skip install (root lockfile only), accept
defaults non-interactively.

Then set workspace package names by editing ONLY the `"name"` field in each
scaffolded app package.json: `"web"` and `"desktop"`.

**Verify**: `bun install` at root → exit 0; `bunx turbo build` → both apps
build their hello-world scaffolds successfully. THIS GATE MUST PASS before
any porting — it proves the monorepo skeleton works.

### Step 5: Port portfolio-2026 into apps/web

1. Delete the scaffold's placeholder `apps/web/app/` directory.
2. Copy from `_archive/portfolio-2026/` into `apps/web/`:
   `app/ components/ hooks/ lib/ models/ public/ scripts/ types/ proxy.ts`
   plus config files: `next.config.ts`, `postcss.config.mjs`,
   `components.json`, `.env.example` — OVERWRITING scaffold versions.
   Do NOT copy: `node_modules`, `bun.lock`, `.next`, `tsconfig.tsbuildinfo`,
   `.git`, `biome.json` (root Biome now), `README.md`, `CLAUDE.md` (root one
   covers it; copy its app-specific content into the root CLAUDE.md only if
   plan 002 added any).
3. tsconfig: keep the scaffold's `apps/web/tsconfig.json` but diff it against
   `_archive/portfolio-2026/tsconfig.json` and port over any compilerOptions
   the old app relied on that the scaffold lacks (e.g. `target`, `types`,
   custom `paths` beyond `@/*`). Strictness must remain `"strict": true`.
4. Install dependencies at latest. From `apps/web/`, run `bun add` with the
   full RUNTIME dependency name list read from
   `_archive/portfolio-2026/package.json` `"dependencies"` — names only, NO
   versions (bun resolves latest), EXCLUDING `react`, `react-dom`, `next`
   (scaffold already pinned the latest ones). Then `bun add -d` with the
   devDependency names, excluding `typescript`, `@types/react`,
   `@types/react-dom`, `@types/node`, `eslint*` (scaffold has current ones)
   and `@biomejs/biome` (root). Include `babel-plugin-react-compiler` and
   `tw-animate-css` etc. as devDeps as in the original.
5. Carry over the old `overrides` block ONLY if Step 5.6's gates fail on
   @types/react mismatches; prefer no overrides.
6. Gates:

```
bun install
bunx turbo typecheck --filter=web
bunx turbo build --filter=web
cd apps/web && bun test --env-file=../../.env
```

**Verify**: build exits 0; typecheck/test match the plan-001 recorded
baseline (pre-existing failures acceptable, new ones are not — except errors
clearly caused by a major-version bump of a dependency; for those see STOP
conditions).

### Step 6: Port denizlg24-app into apps/desktop

Same procedure as Step 5 with:

- Copy dirs: `app/ components/ context/ hooks/ lib/ public/ stores/ src-tauri/`
  + `next.config.ts`, `postcss.config.mjs`, `components.json`.
- Runtime deps from `_archive/denizlg24-app/package.json` (all the
  `@tauri-apps/plugin-*` packages, `@tauri-apps/api`, etc. — names only,
  latest). devDeps include `@tauri-apps/cli`.
- Preserve the original's `"ignoreScripts"` / `"trustedDependencies"` entries:
  replicate their effect with bun's current mechanism (check `bun docs` —
  `trustedDependencies` is a package.json field; copying that one field
  verbatim into apps/desktop/package.json is permitted).
- Check `apps/desktop/src-tauri/tauri.conf.json`: `frontendDist`/`devUrl`
  (or `build.distDir` depending on Tauri config version) must point at the
  app-relative `../out` and `http://localhost:3000` — they were app-relative
  before, so they should be unchanged; confirm, don't assume.
- Gates:

```
bun install
bunx turbo typecheck --filter=desktop
bunx turbo build --filter=desktop
```

**Verify**: build exit 0 AND `apps/desktop/out/` exists (static export — its
absence means `output: "export"` got lost; STOP). `cd apps/desktop && bun test`
→ matches baseline.

### Step 7: Wire turbo.json tasks

Ensure `turbo.json` has (merged with scaffold content, adapt key names to the
scaffolded schema):

```json
{
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": [".next/**", "!.next/cache/**", "out/**"] },
    "dev": { "cache": false, "persistent": true },
    "typecheck": { "dependsOn": ["^typecheck"] },
    "test": {},
    "//#format-and-lint": {},
    "//#format-and-lint:fix": { "cache": false }
  }
}
```

Both apps already have `typecheck`/`test` scripts from plan 001 (they came
along in the port).

**Verify**: `bunx turbo build typecheck test` → runs all three tasks across
both apps; second consecutive `bunx turbo build` run → `FULL TURBO` (cache
hits) for unchanged apps.

### Step 8: Copy local env files, smoke-run, commit

1. Copy `.env*` (except `.env.example`, already ported) from
   `_archive/portfolio-2026/` → `apps/web/`, and any equivalents from
   `_archive/denizlg24-app/` → `apps/desktop/`. Enumerate with
   `git -C _archive/portfolio-2026 status --ignored --porcelain | grep "^!!"`.
2. Smoke: `bunx turbo dev --filter=web` → ready line appears → Ctrl+C. Same
   for desktop (`next dev`; full `tauri dev` is optional — if the Rust
   toolchain is installed, run `cd apps/desktop && bunx tauri dev` and record
   the result; if not installed, record "tauri dev not verified" in the report).
3. `git add -A && git commit -m "Turborepo monorepo: web + desktop"` and
   `git tag monorepo-cutover`.

**Verify**: `git status --porcelain` → empty; `git check-ignore _archive bookmark-extension deniz-nutrition-api macros apps/web/.env` → all matched.

## Test plan

No new unit tests (structural port). The test IS the gate battery:
scaffold-only build gate (Step 4), per-app typecheck/build/test vs the
plan-001 baseline (Steps 5–6), turbo cache verification (Step 7), dev-server
smoke (Step 8). Report MUST include: dependency versions that jumped a major
(old → new), any code changes a migration forced, and tauri-dev
verified/not-verified.

## Done criteria

- [ ] Root: `package.json` + `turbo.json` + single `bun.lock`, scaffold-generated
- [ ] `bunx turbo build` exit 0 for `web` and `desktop`; repeat run shows cache hits
- [ ] `bunx turbo typecheck test` — no NEW failures vs plan-001 baseline (modulo reported major-bump fixes)
- [ ] `apps/desktop/out/` produced; `src-tauri/` present with config paths verified
- [ ] `bun run format-and-lint` executes Biome from root
- [ ] Originals intact in `_archive/` (both `git -C _archive/<app> log` work)
- [ ] Sibling projects + `_archive` + `.env*` gitignored
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- Step 0/drift-check preconditions fail.
- The Step 4 scaffold-only `turbo build` gate fails — the skeleton itself is
  broken; do not start porting on top of it.
- A latest-version dependency introduces a breaking change you cannot resolve
  with its official migration notes in ≤2 focused attempts (likely candidates:
  `mongoose`, `better-auth`, `zod`, `recharts`, `lucide-react` icon renames,
  Tauri plugin majors). Report the package, old→new version, and the error —
  the operator decides between pinning and migrating. Do NOT silently pin.
- `create-next-app` or `create-turbo` refuses to scaffold into the workspace
  (nested-git or non-empty-dir errors you can't resolve by scaffolding to a
  temp dir and moving).
- The desktop build stops producing `out/`, or tauri.conf.json references
  paths outside `apps/desktop/`.
- Any step would require editing a dependency manifest by hand beyond the
  explicitly permitted edits (the two root Biome script lines, the `"name"`
  fields, `trustedDependencies`).

## Maintenance notes

- **Vercel (user action)**: import the new repo on Vercel; set the project
  Root Directory to `apps/web`. Turborepo is auto-detected and Remote Caching
  is zero-config on Vercel. Old standalone-repo project should be retired.
- **Tauri release pipeline (user action)**: any signing/build scripts must
  point at `apps/desktop`.
- `_archive/` holds full git history of both originals; delete only when
  confident. GitHub remotes of the old repos should be archived.
- Plan 004 adds `packages/schemas` (zod) — follow the Turborepo Just-in-Time
  internal-package pattern (raw `.ts` in `exports`, `workspace:*` deps).
- Plan 006 adds CI + Dependabot; it assumes this repo is pushed to GitHub.
- Root `CLAUDE.md` references old paths (`portfolio-2026/`, `denizlg24-app/`)
  — update it after cutover (`apps/web`, `apps/desktop`).
