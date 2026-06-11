# Plan 006: GitHub Actions CI + Dependabot with automatic bun lockfile repair

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: assumes plan 003 landed. Verify: root
> `turbo.json` exists, `bunx turbo build --dry` lists `web` and `desktop`
> tasks, root scripts include `format-and-lint`. If `.github/` already
> contains workflows, STOP and report their contents.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (additive config; worst case is a red CI badge)
- **Depends on**: plans/003-monorepo-conversion.md
- **Category**: dx
- **Planned at**: 2026-06-11 (monorepo layout per plan 003)

## Why this matters

Neither original repo had any CI — every regression ships silently. The
monorepo + Turborepo makes one pipeline cover both apps and all shared
packages. Operator decisions: GitHub Actions CI, plus Dependabot for
dependency updates, plus a workflow that automatically repairs/commits the
bun lockfile on Dependabot PRs so they are mergeable without manual
`bun install` runs.

## Current state

- Monorepo root with `turbo.json`; tasks: `build`, `typecheck`, `test`,
  root task `//#format-and-lint` (Biome). Package manager bun (root
  `bun.lock`).
- No `.github/` directory.
- The repo may not have a GitHub remote yet — file creation works regardless;
  workflows activate on first push (see Maintenance notes for the user
  actions).
- CI yaml below is the Turborepo-documented bun pipeline
  (https://turborepo.dev/docs/guides/ci-vendors/github-actions), extended
  with typecheck/lint and Turbo Remote Cache hooks left commented.

## Commands you will need

| Purpose | Command (repo root) | Expected on success |
|---------|---------------------|---------------------|
| Validate workflow syntax locally | `bunx yaml-lint .github/workflows/*.yml` (or any YAML parse) | parses clean |
| Full local equivalent of CI | `bun install && bunx turbo build typecheck test && bun run format-and-lint` | exit 0 |

(There is no perfect local validator for Actions; the YAML-parse check plus a
green local task run is the gate. If `yaml-lint` isn't available via bunx,
parse the files with `bun -e "console.log(Bun.YAML ? 'ok' : 'ok')"`-style
fallback is NOT required — any YAML parser or editor check suffices; record
which you used.)

## Scope

**In scope** (create only):
- `.github/workflows/ci.yml`
- `.github/workflows/dependabot-lockfile.yml`
- `.github/dependabot.yml`

**Out of scope**:
- Pushing to GitHub, creating the remote, branch-protection rules (user
  actions — list them in your report).
- Turbo Remote Cache secrets (`TURBO_TOKEN`/`TURBO_TEAM`) — leave the
  documented commented lines; user enables later.
- Release/deploy workflows (Vercel deploys via its Git integration; Tauri
  release pipeline is future work).

## Git workflow

- Branch: `advisor/006-ci-dependabot`. One commit. Do NOT push.

## Steps

### Step 1: CI workflow

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: ["main"]
  pull_request:
    types: [opened, synchronize]

jobs:
  build:
    name: Build, typecheck, test, lint
    timeout-minutes: 15
    runs-on: ubuntu-latest
    # To use Turborepo Remote Caching, uncomment:
    # env:
    #   TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}
    #   TURBO_TEAM: ${{ vars.TURBO_TEAM }}
    steps:
      - name: Check out code
        uses: actions/checkout@v4
        with:
          fetch-depth: 2

      - uses: oven-sh/setup-bun@v2

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Build
        run: bunx turbo build

      - name: Typecheck
        run: bunx turbo typecheck

      - name: Test
        run: bunx turbo test

      - name: Lint (Biome)
        run: bun run format-and-lint
```

Note: `--frozen-lockfile` makes CI fail when a PR forgets lockfile updates —
that is exactly what the Step 3 workflow auto-repairs for Dependabot PRs.

**Verify**: YAML parses; `bun install --frozen-lockfile && bunx turbo build typecheck test && bun run format-and-lint`
locally → exit 0 (if typecheck/test have pre-existing recorded failures from
the plan-001 baseline that were never fixed, STOP and report — CI would be
born red; the operator must decide whether to fix or soft-fail those tasks).

### Step 2: Dependabot config

Create `.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: "bun"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 10
    groups:
      minor-and-patch:
        update-types: ["minor", "patch"]

  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
```

The `bun` ecosystem updates `package.json` entries across the workspace and
regenerates the root `bun.lock`. If GitHub rejects `package-ecosystem: "bun"`
when the repo is pushed (support is account/feature dependent), the fallback
is `package-ecosystem: "npm"` with
`versioning-strategy: increase` — record in `plans/README.md` if the fallback
was needed, because then the lockfile-repair workflow in Step 3 stops being a
safety net and becomes the primary lockfile mechanism.

**Verify**: YAML parses.

### Step 3: Lockfile auto-repair on Dependabot PRs

Create `.github/workflows/dependabot-lockfile.yml`:

```yaml
name: Dependabot lockfile repair

on:
  pull_request:
    types: [opened, synchronize]

permissions:
  contents: write

jobs:
  fix-lockfile:
    if: github.actor == 'dependabot[bot]'
    runs-on: ubuntu-latest
    steps:
      - name: Check out PR branch
        uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.ref }}
          repository: ${{ github.event.pull_request.head.repo.full_name }}

      - uses: oven-sh/setup-bun@v2

      - name: Regenerate lockfile
        run: bun install

      - name: Commit updated lockfile if changed
        run: |
          if ! git diff --quiet -- bun.lock; then
            git config user.name "github-actions[bot]"
            git config user.email "github-actions[bot]@users.noreply.github.com"
            git add bun.lock
            git commit -m "chore: update bun.lock for dependabot changes"
            git push
          else
            echo "Lockfile already up to date"
          fi
```

Two known constraints to put verbatim in your report so the operator isn't
surprised:
- Commits pushed with the default `GITHUB_TOKEN` do NOT retrigger `ci.yml`
  (GitHub prevents recursive workflow runs). If the operator wants CI to
  re-run on the repaired commit, they must later swap in a PAT or a GitHub
  App token — out of scope here.
- If branch protection later requires signed commits, this bot commit will
  be rejected; the operator chooses between exempting the bot or dropping
  auto-repair.

**Verify**: YAML parses; `if:` condition and `permissions: contents: write`
present exactly as above (these two lines are the security boundary — the
workflow must never run `bun install` + push for arbitrary fork PRs;
`github.actor == 'dependabot[bot]'` gates it).

### Step 4: Commit

`git add .github && git commit -m "Add CI, Dependabot, and lockfile auto-repair"`.

**Verify**: `git status --porcelain` → empty;
`git show --stat HEAD` → exactly 3 new files under `.github/`.

## Test plan

No unit tests (config-only). Gates: YAML parse on all three files + the full
local CI-equivalent command chain green. Real-world validation happens on
first push (user action): CI runs on `main`, Dependabot opens its first PRs
within a week.

## Done criteria

- [ ] Three files exist under `.github/` with content matching the steps
- [ ] All three parse as valid YAML
- [ ] Local chain `bun install --frozen-lockfile && bunx turbo build typecheck test && bun run format-and-lint` → exit 0
- [ ] Lockfile workflow contains the `dependabot[bot]` actor gate and minimal `permissions`
- [ ] `git status` — only `.github/**` added
- [ ] `plans/README.md` status row updated (incl. npm-fallback note if applicable)

## STOP conditions

Stop and report back if:

- The local CI-equivalent chain fails on pre-existing issues (CI would start
  red — operator decides what to fix or soft-fail first).
- `.github/` already exists with workflows (don't overwrite unknown CI).
- You are tempted to add `pull_request_target` anywhere — do not; it changes
  the security model. Report why you thought it was needed instead.

## Maintenance notes

**User actions after merge** (put these in the completion report):
1. Create the GitHub repo, `git push -u origin main` — workflows + Dependabot
   activate on push.
2. Optionally enable Turbo Remote Caching: `bunx turbo login && bunx turbo link`,
   then add `TURBO_TOKEN` secret + `TURBO_TEAM` var and uncomment the env
   lines in `ci.yml`.
3. Branch protection on `main` requiring the `Build, typecheck, test, lint`
   check is recommended once CI is green.
4. Vercel Git integration deploys `apps/web` independently of this CI.

- If the `bun` Dependabot ecosystem fell back to `npm`, revisit quarterly —
  native bun support removes the need for the repair workflow.
- When packages gain real build outputs (compiled packages), extend
  `turbo.json` `outputs` so CI cache stays correct.
