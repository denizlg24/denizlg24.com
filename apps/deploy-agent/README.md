# deploy-agent

The executor half of the forge deploy platform. Runs on the deploy host, builds
and runs deployments, and reports back to the control plane in `apps/api`.

Plan: `docs/internal/plans/deploy-platform.md`.

## Release

`.github/workflows/release-deploy-agent.yml` builds and tests the host binary,
then waits at the protected `forge` environment for approval. The approved job
stages the binary and service assets over the tailnet, verifies the checksum,
and invokes the host's narrowly scoped installer.

## Configuration

`/etc/forge/agent.env`, read by the systemd unit.

| Variable | Default | Notes |
|---|---|---|
| `AGENT_BIND_ADDRESS` | — | **Required.** The host's Tailscale address. Wildcards and public addresses are refused at startup. |
| `AGENT_PORT` | `4010` | |
| `AGENT_TOKEN` | — | **Required**, ≥32 chars. Must match the API's `DEPLOY_AGENT_TOKEN`. |
| `CONTROL_PLANE_URL` | — | **Required.** e.g. `https://api.denizlg24.com` |
| `MAX_CONCURRENT_BUILDS` | `3` | 1–4, and it bounds concurrent *builds*, not deployments — see below. A Next.js build peaks 2–4 GB. |
| `CLAIM_POLL_MS` | `3000` | |
| `HEARTBEAT_MS` | `30000` | Must stay well under the control plane's 15-minute interrupted-run threshold. |
| `BUILD_ROOT` | `/srv/forge/builds` | Checkouts. Production sets `/mnt/storage/forge/builds`; removed after every build, pass or fail. |
| `LOG_ROOT` | `/srv/forge/logs` | One `<deployment-id>.log` per run. Production sets `/mnt/storage/forge/logs`. |
| `CACHE_ROOT` | `/srv/forge/cache` | Exported cache fallback. Production sets `/mnt/storage/forge/cache`. |
| `RUN_ENV_ROOT` | `/run/forge` | tmpfs. Holds a deployment's env file for the length of one `docker run`. |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | |
| `DOCKER_DATA_ROOT` | `/var/lib/docker` | Runtime images and container layers; kept on SSD and reported separately by `/healthz`. |
| `BUILDX_BUILDER` | `forge` | Production sets `forge-hdd`. GC prunes this exact builder. |
| `BUILDKIT_ENDPOINT` | — | Production sets `docker-container://forge-buildkit`; only this managed transport is accepted. |
| `DOCKER_NETWORK` | `forge-apps` | The network every deployment container joins. |
| `CADDY_ADMIN_URL` | `http://127.0.0.1:2019` | Refused at startup unless it points at loopback. |
| `CADDY_LISTEN` | `127.0.0.1:8080` | What cloudflared's catch-all ingress targets. Keep it on loopback. |
| `CADDY_STATE_PATH` | `/srv/forge/caddy/config.json` | The route table replayed at agent start. |
| `BUILD_MEMORY_LIMIT_MB` | `6144` | See the caveat under Building. |
| `MEMORY_HEADROOM_MB` | `1024` | Kept for Linux, Docker, the agent and Caddy; excluded from deploy capacity. |
| `HEALTH_POLL_MS` | `2000` | The gate's poll interval; the budget comes from the request. |
| `CONTAINER_DRAIN_MS` | `10000` | How long a superseded container keeps serving after the route flips. |

The agent refuses to start on a bad bind address rather than falling back to
loopback. A silent fallback would mean the API cannot reach it and the failure
surfaces as a mysterious timeout hours later.

## HTTP surface

`GET /healthz` is unauthenticated — the listener is already tailnet-only, and
gating it would mean local probes need a secret to ask whether the process is
alive. Everything else needs `Authorization: Bearer $AGENT_TOKEN`.

| Method | Path | |
|---|---|---|
| `GET` | `/healthz` | 503 when it cannot deploy, 200 otherwise |
| `GET` | `/deployments` | running plus recent history |
| `POST` | `/deployments` | manual enqueue; 429 at capacity |
| `GET` | `/deployments/:id` | |
| `GET` | `/deployments/:id/logs` | SSE, replayed from the first line then tailed |
| `POST` | `/deployments/:id/cancel` | 409 if not running |
| `POST` | `/deployments/:id/restart` | `docker restart`, no rebuild, no route change |
| `POST` | `/deployments/:id/promote` | replaces the deployment's hostname set; 409 if it has no live route |
| `DELETE` | `/deployments/:id` | route, container and image; idempotent, never 404s |
| `GET` | `/routes` | the live Caddy routing table |
| `GET` | `/telemetry` | Host CPU/load/memory plus Forge-labelled containers, per-container stats, images, and disk capacity |
| `GET` | `/containers/:id/logs` | SSE stdout/stderr tail for a Forge-labelled container only |
| `POST` | `/gc` | runs the reaper; body carries the keep set |

`/healthz` pings Docker and stats both the Docker data root and the build root
on every call. Either disk being unreadable or critically full makes the agent
unavailable.

## Queue

The agent keeps **no backlog of its own**. The control plane's `deployments`
table is the queue; this process only holds what is actively running. So a
restart loses nothing, and two agents cannot disagree about what is pending.

`POST /deployments` therefore refuses at capacity instead of queueing locally —
a second queue on this side would be invisible to the control plane and would
survive a restart differently from the real one.

Reporting status doubles as the heartbeat: the control plane refreshes
`heartbeatAt` on every status write, and a run with no heartbeat for 15 minutes
is reclaimed as `interrupted`.

## The pipeline

`pipeline.ts` composes `build.ts` → `ports.ts` → `run.ts` into the runner the
queue calls, reporting a phase at each transition because "building" is four
minutes long and a spinner that never moves reads as a hang.

### Cloning

`git init` in an empty tree, then `git fetch --depth 1 <url> <sha>` — the SHA,
not the branch. The branch may have moved between the webhook and the build, and
a deployment that claims one commit while running another is the worst kind of
wrong. No remote is added, so the clone URL never lands in `.git/config`. A
server that refuses a bare-SHA want falls back to fetching the ref.

The URL carries an installation token, so every line the build writes goes
through `BuildLog`, which redacts registered secrets. That is why the log is
line-buffered: a token split across two reads of git's stderr would slip past a
chunk-wise filter, and a secret never spans a newline. Git also runs with
`GIT_TERMINAL_PROMPT=0` — otherwise a private repo with no token blocks on a
credential prompt until the build timeout, which looks nothing like "no access".

### Building

`auto` picks Dockerfile when one is present in the build context, Nixpacks
otherwise; `dockerfile` and `nixpacks` pin it. The repository root is the build
context, `rootDirectory` selects the service, and `dockerfilePath` is resolved
from the repository root.

`installCommand` and `buildCommand` are **rejected** on the Dockerfile path
rather than accepted and ignored. `startCommand` is allowed there as a run-time
`CMD` override, and is passed to Nixpacks at build time on the other path — so
it is never passed twice.

For Nixpacks monorepo targets, the agent passes `nixpacks.toml` or
`nixpacks.json` from the selected `rootDirectory`. This lets a Python workspace
force the Python provider even when a root `package.json` would otherwise
produce a Node-only image. A custom Python install command is run inside
`/opt/venv`; replacing Nixpacks' install phase without recreating that
virtualenv removes `pip` from the command path.

Both paths tag `forge/<slug>:<sha>-<id8>` and the moving
`forge/<slug>:latest`. With the production external builder, Nixpacks first
generates its Dockerfile and both builder paths run through `forge-hdd`.
BuildKit's content store and cache mounts stay on the HDD; the Docker exporter
copies the completed image into Docker's SSD-backed runtime store. The agent
uses an uncompressed output for that load: both stores are local, so gzip only
adds CPU and HDD latency to the `exporting layers` phase without saving network
bandwidth.

The host's allocatable deployment memory is total RAM minus
`MEMORY_HEADROOM_MB` and one `BUILD_MEMORY_LIMIT_MB` reserve for every build
slot. The control plane compares target reservations with that fixed budget
before enqueueing a deployment. A target may burst above its reservation up to
its derived ceiling, but only the reservation is committed capacity.

`BUILD_MEMORY_LIMIT_MB` is passed as `--memory`, but BuildKit ignores that flag:
the effective cap is `buildkitd`'s own. Treat it as belt-and-braces, not as the
control.

When `BUILDKIT_ENDPOINT` is configured, an unavailable HDD builder fails the
deployment instead of silently falling back to the SSD. Without an external
endpoint, the legacy per-target exported cache under `$CACHE_ROOT` remains
available and is capped by the request's age and size settings.

### What bounds the build cache

Two mechanisms, and for months neither did anything while the cache grew to
324 GB:

- **`buildkitd`'s own GC** is the one that runs continuously, and it only fires
  on the thresholds in `infra/systemd/forge-buildkitd.toml`. `maxUsedSpace` is
  the real cap. Set to a percentage of a 916 GiB disk it put the trigger past
  700 GB, which is indistinguishable from having no GC at all.
- **`POST /gc`** runs `docker buildx prune --builder $BUILDX_BUILDER --all` and
  the daemon's own, both filtered by `builderPruneHours`. `--all` is required:
  without it a prune only reaps records nothing reaches, which on a worker that
  keeps state across builds is almost none of them. The window matters just as
  much — the old 168h default spared everything on a host that builds twenty-five
  times a day.

Read `builderCacheReclaimedBytes` on the task run, not the run status. A pass
that reclaims nothing still completes.

### Build slots and deploy concurrency

`MAX_CONCURRENT_BUILDS` gates the build, and a run hands its slot back the
moment the image exists — `releaseBuildSlot` in the pipeline, before the
container starts. What follows is starting a container and polling it until it
answers, which costs the builder nothing and which a deployment's own memory
reservation already accounts for. Holding a slot across it left the builder
parked behind a health probe.

Two consequences worth knowing:

- `running` and `building` in the queue snapshot are different numbers.
  `maxInFlight` (default `capacity × 4`) is the ceiling on the first, and only
  bites when something after the build stalls — a health probe waiting out its
  timeout cannot then claim the whole queue and exhaust the port range.
- The control plane will not claim two deployments for the same target at once.
  `reapSuperseded`, the `forge/<slug>:latest` tag and the `id=<targetId>` cache
  mounts are all keyed by target rather than by deployment, so overlapping runs
  for one target fight over all three. Different targets still build in
  parallel, which is the case the extra slots exist for.
- Nixpacks Bun installs are the deliberate exception to that parallelism. Their
  per-target package caches all live in the same HDD-backed BuildKit store, so
  the agent adds a worker-wide `sharing=locked` cache mount to generated Bun
  install steps. Only installs take turns; setup, builds and image exports still
  run concurrently, and the original warm package caches remain intact.

### Running and the health gate

Ports come from 20000–29999, picked at random and probed before use. Random
rather than sequential because a sequential allocator hands back a port a client
may still hold a keep-alive connection to.

The resolved environment is written to `/run/forge/<id>.env` at mode 0600 and
deleted as soon as `docker run` returns. Values containing newlines are refused:
`--env-file` cannot represent them and would silently produce two broken entries.

The gate polls `http://127.0.0.1:<port><healthPath>` and accepts **any status
under 500** — requiring 200 breaks every app whose root is a redirect and every
API-only surface whose root is a 404, and a 404 from the app still proves the
app is listening. It gives up early if the container exits.

On failure the new container's last 200 log lines go into the build log, the new
container is removed, and **the container currently serving the hostname is left
exactly as it was**. That branch is the entire point of the gate.

On success the route is published, `ready` is reported, and only then is the
superseded container drained for `CONTAINER_DRAIN_MS` and removed. Reaping is
scoped to `forge.target` + `forge.kind=production`: preview hostnames are unique
per deployment, so reaping previews by target would kill another branch's live
preview. Those are the GC pass's business.

### Routing

Caddy runs with **no Caddyfile** and its admin API on loopback; the agent owns
the config outright and every change is a full `POST /load`. Patching individual
route indices is the alternative and it is a trap — an index computed before a
concurrent delete addresses the wrong route, and the symptom is one hostname
quietly serving another app.

Writes are serialised. Two deployments finishing together would otherwise each
build a full config from its own view of the table, and the later `/load` would
erase the earlier one's route. A config Caddy rejects is rolled back out of the
in-memory table, so it cannot be smuggled into the next deploy's reload.

Every route sets `X-Forwarded-Proto: https`. cloudflared speaks plain HTTP to
Caddy, and without it Next.js generates `http://` absolute URLs and anything
doing an HTTPS redirect redirects to itself forever.

The table is persisted to `CADDY_STATE_PATH` after each successful load and
replayed at agent start — Caddy with no Caddyfile boots empty, so a Caddy
restart would otherwise black-hole every live deployment until something
happened to redeploy it. A failure to *write* that file is logged, not raised:
routing is already correct, and failing the deploy over it would remove a
container that is serving traffic.

## Garbage collection

`POST /gc` reaps; it does not decide. The agent has no view of deployment
status — that lives in Postgres — so the control plane resolves what is still
wanted and sends it as `keepDeploymentIds` and `keepImageTags`. Containers are
removed before images, because an image a container still references cannot be
removed and reaping in the other order turns every removable image into a
failure. The image of a container that could not be removed is likewise kept,
so one problem produces one line in the report rather than two.

Per-item failures land in `report.failures`, never in the response status. One
unremovable image must not mark the sweep failed and mute the disk notification
that actually matters — the same shape as `tieringReport.failures`, for the
same reason.

`forge/<slug>:latest` is never a candidate. It looks like a stale tag and it is
the thing making the next build fast.

BuildKit cache cleanup is sent to the configured named builder, so production
GC reclaims `/mnt/storage/forge/buildkit`. Image cleanup still talks to the
normal Docker daemon and reclaims `/var/lib/docker`. The report exposes both
filesystems separately.

## Status

Days 2–4 of the plan, plus `restart`, `promote` and `/gc`. A deployment mints
its route the moment the health gate passes, and `DELETE /deployments/:id`
takes the route, container and image back down. The DNS record that points a
hostname at the tunnel is the control plane's half —
`packages/cloud-core/src/deploy/`.

```sh
bun test
bun run typecheck
```
