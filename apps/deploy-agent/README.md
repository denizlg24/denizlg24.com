# deploy-agent

The executor half of the forge deploy platform. Runs on the deploy host, builds
and runs deployments, and reports back to the control plane in `apps/api`.

Plan: `docs/internal/plans/deploy-platform.md`.

## CI does not deploy this

Same as `apps/storage-metadata` and `apps/terminal`. Pushing to `main` rebuilds
the API container and does nothing here. The binary is replaced by hand:

```sh
bun run build:host                      # → dist/forge-agent (linux-x64)
dd if=dist/forge-agent of=/tmp/forge-agent bs=1M
# copy to the host, then:
sudo install -m 0755 /tmp/forge-agent /usr/local/bin/forge-agent
sudo systemctl restart deploy-agent
```

Use `dd`, not a shell `cat` — piping a compiled binary through a shell can
corrupt it, and the failure looks like a crash-loop with no useful message.

## Configuration

`/etc/forge/agent.env`, read by the systemd unit.

| Variable | Default | Notes |
|---|---|---|
| `AGENT_BIND_ADDRESS` | — | **Required.** The host's Tailscale address. Wildcards and public addresses are refused at startup. |
| `AGENT_PORT` | `4010` | |
| `AGENT_TOKEN` | — | **Required**, ≥32 chars. Must match the API's `DEPLOY_AGENT_TOKEN`. |
| `CONTROL_PLANE_URL` | — | **Required.** e.g. `https://api.denizlg24.com` |
| `MAX_CONCURRENT_BUILDS` | `1` | 1–4. A Next.js build peaks 2–4 GB. |
| `CLAIM_POLL_MS` | `3000` | |
| `HEARTBEAT_MS` | `30000` | Must stay well under the control plane's 15-minute interrupted-run threshold. |
| `BUILD_ROOT` | `/srv/forge/builds` | Checkouts. Removed after every build, pass or fail. |
| `LOG_ROOT` | `/srv/forge/logs` | One `<deployment-id>.log` per run. |
| `CACHE_ROOT` | `/srv/forge/cache` | |
| `RUN_ENV_ROOT` | `/run/forge` | tmpfs. Holds a deployment's env file for the length of one `docker run`. |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | |
| `DOCKER_DATA_ROOT` | `/var/lib/docker` | What `/healthz` stats for disk pressure. |
| `DOCKER_NETWORK` | `forge-apps` | The network every deployment container joins. |
| `BUILD_MEMORY_LIMIT_MB` | `6144` | See the caveat under Building. |
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

`/healthz` pings the Docker daemon and stats the Docker data root on every call.
A liveness probe that only proves the process is up reports green while every
build fails, which is worse than having no probe at all.

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
otherwise; `dockerfile` and `nixpacks` pin it. `rootDirectory` is the build
context and `dockerfilePath` is resolved inside it.

`installCommand` and `buildCommand` are **rejected** on the Dockerfile path
rather than accepted and ignored. `startCommand` is allowed there as a run-time
`CMD` override, and is passed to Nixpacks at build time on the other path — so
it is never passed twice.

Both paths tag `forge/<slug>:<sha>-<id8>` and the moving `forge/<slug>:latest`,
and the Docker path passes `--cache-from forge/<slug>:latest` with
`BUILDKIT_INLINE_CACHE=1`. **The moving tag must not be reaped** — it is the
whole layer cache (§2.6/§7.2).

`BUILD_MEMORY_LIMIT_MB` is passed as `--memory`, but BuildKit ignores that flag:
the effective cap is `buildkitd`'s own. Treat it as belt-and-braces, not as the
control. The per-target BuildKit local cache export (§2.6 layer 2) is not wired
up — `--cache-to type=local` needs a `docker-container` driver builder, which is
a host change, and it lands with the cache capping on day 8.

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

## Status

Day 3 of the plan. Clone → build → run → health gate → reap works end to end and
is driven by `curl` against the agent.

**Routing is not wired.** `loopbackOnlyRouteManager` publishes nothing, so a
healthy deployment is reachable on `127.0.0.1:<port>` and nowhere else; the build
log records that port. Day 4 replaces it with the Caddy admin-API client.

Also not yet here: `promote`, `DELETE /deployments/:id`, `restart`, `/routes`,
`/gc`, and the control-plane routes the claim loop polls (day 5).

```sh
bun test
bun run typecheck
```
