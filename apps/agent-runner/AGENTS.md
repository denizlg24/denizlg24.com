# agent-runner

A compiled Bun host daemon on Forge that executes sprint slots: every 15 s it
claims due runs from web (`/api/admin/sprints/runner/*`), runs Claude Code
headless in one container per run on the rootless sandbox daemon, pushes the
sprint branch, manages the PR, and reports back. Design:
`docs/internal/plans/033-sprint-agent.md` (§2, §3, §6, §7).

- `src/loop.ts` — claim tick (capacity + admission), merge commands, PR watches
- `src/run.ts` — one run's lifecycle; `src/recovery.ts` — boot re-attach
- `src/workspace.ts` — mirrors, worktrees, `SPRINT.md`, result, 24 h GC
- `src/github.ts` — run tokens, PR, review, CI wait, merge-by-sha
- `src/network.ts` — the `agent-runs` network and its drop rules
- `src/harness/` — `HarnessAdapter` and the Claude Code implementation
- `src/prompts/*.md` — kind preambles, embedded at compile time
- `runtime.Dockerfile`, `runtime/` — the image runs execute in

## What bites

- **`runsc` must be `/usr/local/bin/runsc-scoped`.** Plain `runsc` on the
  rootless daemon accepts `--memory`, `--cpus` and `--pids-limit` and enforces
  none of them. The runner reads `docker info` at boot and refuses to start
  unless the runsc runtime's path is the wrapper. `AGENT_RUNNER_CONTAINER_RUNTIME=runc`
  is the Phase 0 G1 fallback (same rootless daemon, still a user namespace).
- **The runner holds no state web does not.** Runs are found again by the
  `agent-runner.run=<runId>` container label alone. On boot every labelled
  container gets a heartbeat: `live: false` → stopped and removed; live →
  supervised again from the start of `docker logs --follow` (messages are
  upserted by id, so the replay is idempotent). `state/<runId>.json` holds
  only the claimed run and which post-exit steps already happened, so a
  restart mid-CI-wait never posts a review or creates a PR twice. A runner
  restart (its own release) never stops a run.
- **Transcript `seq` is wall-clock milliseconds**, not a counter: web ignores
  a seq it has seen, and a re-attached supervisor must not start below the
  last one sent.
- **The first install is by hand.** The release runs the *installed*
  `forge-agent-install`; `--install-agent-runner` exists only after a deploy
  agent release has shipped the new script. By hand: stage `agent-runner`,
  `agent-runner.service` and `agent-runner-slice.conf` into
  `/var/lib/forge-agent/staging/`, run
  `sudo forge-agent-install --install-agent-runner`, write
  `/etc/agent-runner/env` (0600, `sandbox-runner`), then
  `systemctl enable --now agent-runner`. The install script restarts the unit
  on later releases only when it is enabled.
- **The image is pinned by digest.** `AGENT_RUNNER_RUNTIME_IMAGE` without
  `@sha256:` is refused. A runtime release changes nothing until the pin in the
  env file moves; bumping Claude Code is that, deliberately. The image's
  `CLAUDE_CODE_VERSION` and `CLAUDE_CODE_VERSION` in
  `src/harness/claude-code.ts` move together: the stream-json shapes and CLI
  flags are what this parses.
- **The egress rules are applied by a privileged runc helper, never from the
  host.** The bridges live in rootlesskit's detached netns. Two simpler routes
  fail on Forge: a `--network host` container lands in the *real* host netns
  (`--detach-netns`), and a host-side `nsenter --user` into rootlesskit's user
  namespace gets no capabilities, because Ubuntu sets
  `kernel.apparmor_restrict_unprivileged_userns=1` — iptables answers "you
  must be root" for both. A container the daemon starts inherits rootlesskit's
  AppArmor profile and is root of its user namespace (only), so at boot and
  every 5 min the runner runs the runtime image as `docker run --rm --runtime
  runc --privileged --pid host --network none --entrypoint nsenter …
  --net=/proc/<child_pid>/root<state-dir>/netns` with the image's iptables:
  chain `AGENT-RUNS-EGRESS` jumped from `DOCKER-USER` for the `agent-runs0`
  bridge, plus an `INPUT` drop so a run cannot reach the daemon's netns. It
  reads them back and admits nothing while they are missing. Without them a
  run reaches Forge's tailnet SSH, the daemon's TCP listener and
  `forge-apps` containers; with them all three time out under runc and runsc
  while Anthropic and GitHub stay open (measured 2026-11-07). The runtime
  image must keep `iptables` and util-linux's `nsenter` for this.
- **runsc cannot resolve names on a user-defined network.** gVisor's netstack
  never passes the DNAT that makes Docker's embedded resolver (127.0.0.11)
  work, and `--dns` only changes that resolver's upstream. Every container on
  `agent-runs` mounts `<root>/resolv.conf` (written at boot from
  `AGENT_RUNNER_DNS`, public resolvers) over `/etc/resolv.conf`. Measured:
  without it github.com does not resolve under runsc; with it, it does under
  both runtimes.
- **gVisor costs ~1.1–1.25× here** (G1, 2026-11-04, 8 GB / 4 CPU limits): cold
  `bun install` of this monorepo 111 s runc → 118 s runsc, `turbo typecheck
  --filter=web` 98 s → 122 s. Hardlink installs and the 6 GB-heap typecheck
  work under runsc.
- **Ownership: the container is uid 1000, the runner is uid 1001.** Under the
  rootless daemon container uid 1000 is a subuid on the host, so the runner
  cannot write what a run wrote, nor the reverse. Everything that touches a
  worktree or mirror runs in a container (git helpers as uid 1000; removal as
  namespace root under runc). The directories a run writes into are owned by
  that subuid (computed from `/etc/subuid`, chowned by a runc helper) and
  carry an ACL entry for the runner: gVisor checks mode bits and ignores
  ACLs, so an ACL grant alone works under runc and is "Permission denied"
  under runsc (the first e2e, 2026-11-07). A run escaping
  its sandbox lands as a subuid, not as `sandbox-runner` who can read the env
  file.
- **Worktrees and mirrors are mounted at their host paths**, not at `/work`:
  a worktree's `.git` names its gitdir in the mirror by absolute path. `/out`
  (`runs/<id>-out`) is the one remapped mount. The agent can write the
  mirror (commits need it); the runner's own git steps therefore disable
  hooks and fsmonitor.
- **An auth failure is `is_error: true` with subtype `success`.** `is_error`
  alone decides `harness-error`.
- **REQUEST_CHANGES on its own PR is refused by GitHub**, and the app both
  opens and reviews the PR; a 422 falls back to COMMENT, then to a review with
  every finding in the body.
- **Branch protection is unreadable with a run token** (no administration
  permission). Required checks come from the rulesets API; with none, every
  check on the head sha counts.

## Env (`/etc/agent-runner/env`)

`AGENT_RUNNER_OAUTH_CLIENT_ID` / `_SECRET` (service client with the web and
api resources), `AGENT_RUNNER_FORGE_HEALTH_URL` (the deploy agent's
`/healthz` on its tailnet address), `AGENT_RUNNER_RUNTIME_IMAGE` (digest),
`AGENT_RUNNER_GIT_NAME` / `_EMAIL`, `CLAUDE_CODE_OAUTH_TOKEN` and/or
`AI_GATEWAY_API_KEY`. Defaulted: `AGENT_RUNNER_WEB_URL`, `AGENT_RUNNER_API_URL`
(and `_RESOURCE`s, `AGENT_RUNNER_OAUTH_ISSUER`) to production,
`AGENT_RUNNER_MAX_CONCURRENT=2`, `AGENT_RUNNER_ROOT=/mnt/storage/agent-runs`,
`AGENT_RUNNER_CONTAINER_RUNTIME=runsc`, `AGENT_RUNNER_MIN_MEM_AVAILABLE_GB=10`,
`AGENT_RUNNER_MIN_FREE_DISK_GB=50`. `AGENT_RUNNER_BLOCKED_ADDRESSES` adds the
host's public addresses to the drop list. Only the credential a slot chose is
passed into its container, through an env file deleted once `docker run`
returns.

## Sprint model (web side and runner)

Scheduled coding-agent runs. Design: `docs/internal/plans/033-sprint-agent.md`;
the runner's own bites are in `apps/agent-runner/AGENTS.md`. A sprint is one
branch and one PR on a repository; its slots (`implement`, `review`,
`fix-review`, `release`, `custom`) chain through `dependsOn` and each slot
builds on the branch the previous one left. Web (`lib/sprints/`, Mongo
`Sprint` / `SprintSlot` / `CodingRun`) is the only source of truth; the
admin UI is `packages/admin/src/sprints/`, the MCP tool `web_sprints`.

- **The runner pulls; web never calls it.** Every 15 s it claims due slots
  (`/api/admin/sprints/runner/claim`), heartbeats each run every 30 s (the
  heartbeat answer is the cancel path) and posts transcript batches and the
  completion. A run is dead when its 3-minute lease lapses — the claim and
  the `/api/jobs/agent-memory` tick both sweep — never because it is old.
  Slot evaluation is pure (`@repo/utils/sprints` `evaluateSlot`).
- **Only one machine client may drive runs.** The runner routes accept a
  token only when its client is `AGENT_RUNNER_CLIENT_ID` (web); the owner's
  own session is refused there too. On the API,
  `POST /api/deploy/github/run-token` admits the owner and the clients in
  `AGENT_RUNNER_CLIENT_IDS`, and mints a 1-hour installation token scoped to
  one repository and the slot kind's permissions — a review token cannot
  write contents. `machineClientId` on the API's auth context is what tells a
  machine token's client apart; owner's guard admits every superuser machine
  token, which is why the route is mounted ahead of it.
- **A release only fires on an approved chain and ends as an offer.** Every
  transitive upstream succeeded, the latest review approved (or a succeeded
  fix-review followed it), and the sprint has a PR; no review at all is not
  approved. After CI is green on the head SHA the sprint carries
  `release.state: ready`; Merge (owner only — no MCP action) merges by that
  SHA, so a commit landing after CI is never merged on its strength.
- **The result contract is `$SPRINT_OUT/result.json`, validated by the
  runner.** A missing or invalid file fails the run as `no-result` even on
  exit 0. The runner, not the agent, commits leftovers, pushes, opens the
  draft PR and posts the review.
- **The transcript is Claude Code's stream-json mapped to AgentUIMessages**
  (`@repo/utils/claude-stream`), one step message per API `message.id`,
  upserted by id and bounded at `CODING_RUN_MAX_PARTS`. `seq` is wall-clock
  milliseconds so it keeps rising across a runner restart. An auth failure
  arrives as `is_error: true` with `subtype: "success"`; `--bare` skips OAuth
  and must never be passed.
- **Phase 0, as measured on Forge 2026-11-04.** G1 passed: runsc costs
  1.06× on a cold `bun install` and 1.24× on web's typecheck, so it stays the
  default. G2 found that a `--network host` helper cannot touch the rootless
  daemon's rules (`--detach-netns` puts it in the real host netns), and a
  host-side `nsenter --user` gets no capabilities under Ubuntu's
  `apparmor_restrict_unprivileged_userns`; the runner applies them from a
  privileged runc helper container (`--pid host`, `nsenter --net` into the
  detached netns), proven on 2026-11-07. runsc cannot use Docker's embedded DNS on a user network, so
  runs mount a `resolv.conf` with public resolvers. The `gateway` credential
  works (G3: `ANTHROPIC_BASE_URL=https://ai-gateway.vercel.sh` +
  `ANTHROPIC_AUTH_TOKEN`, aliases like `haiku` resolve, tool use and
  stream-json intact); a rejected key is not a quick failure but up to ten
  `system/api_retry` 401s with backoff, which the transcript shows as one
  warning. Still open: the Team-seat token (G3) and the App's permissions
  (G4 — contents, pull requests, checks, **commit statuses**, actions).
  `main` here has required a pull request since 2026-11-04 (ruleset `master`;
  its status-check rule names no checks, so it never blocked a push on its
  own) — every repository a sprint targets needs the same, or a run token
  can push to its default branch.
- **Pushes carry no URL.** The dashboard app only routes `dashboard://`
  links and has no sprint screen. Kinds `sprint_run_started` (off by
  default), `_finished`, `_failed` (also skips) and `sprint_release_ready`.
- **The first runner install is by hand**, like every new staged unit:
  `release-agent-runner.yml` runs the *installed* `forge-agent-install`, and
  its `--install-agent-runner` mode exists only after a deploy-agent release
  shipped it. The runtime image (`release-agent-runner-runtime.yml`) is pinned
  by digest in `/etc/agent-runner/env`; bumping Claude Code is an image
  release.
- **Rollout:** G4 grants and a `main` ruleset on target repos → Phase 0 →
  merge (the API release carries the run-token route) → a `service` client
  `agent-runner` with the web and api resources, `AGENT_RUNNER_CLIENT_ID` on
  web and `AGENT_RUNNER_CLIENT_IDS` on the API → `claude setup-token` and the
  Gateway key → first install, `/etc/agent-runner/env`,
  `systemctl enable --now agent-runner` → the e2e.
