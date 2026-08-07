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
| `BUILD_ROOT` | `/srv/forge/builds` | |
| `LOG_ROOT` | `/srv/forge/logs` | |
| `CACHE_ROOT` | `/srv/forge/cache` | |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | |
| `DOCKER_DATA_ROOT` | `/var/lib/docker` | What `/healthz` stats for disk pressure. |

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

## Status

Day 2 of the plan. Config, auth, health, the queue loop and the HTTP surface are
implemented and tested. **The build pipeline is not** — the wired runner throws
`Build pipeline is not implemented yet`, so a claimed deployment is reported
`failed` rather than being silently marked ready. Day 3 replaces it with
clone → build → run → health-gate.

```sh
bun test
bun run typecheck
```
