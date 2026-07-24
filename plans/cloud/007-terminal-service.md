# Cloud 007: Terminal service rewrite — hardened, persistent, unprivileged

> **Executor instructions**: Follow step by step. Run every verification
> command. On STOP conditions, stop and report. When done, update
> `plans/cloud/README.md`.

## Status

- **Executor**: gpt5.6
- **Effort**: M
- **Risk**: MED (security-sensitive; host shell access)
- **Depends on**: 006 (auth middleware from 003; infra wiring finalized in 011)
- **Category**: security / backend

## Why the old one is being replaced, not fixed

`vendor/deniz-cloud/packages/terminal-server/src/index.ts` +
`docker-compose.yml`:

- Container runs `privileged: true, pid: host` and spawns
  `nsenter -t 1 -m -u -i -n -p -- /bin/bash -il` → a root host shell from a
  container. Full host compromise surface.
- WebSocket server on :3003 has **no authentication in the terminal server
  itself** (relies on admin-api proxying; the port is also published on the
  compose host).
- `mem_limit: 64m` with node-pty + bash → OOM kills mid-session ("crashes").
- Fixed 80x24 until a resize message; sessions die on disconnect (WeakMap,
  no reattach); no heartbeat, no backpressure → large outputs kill the socket.

## Target design (locked: "rewrite hardened"; Tailscale SSH is primary access)

- **Runs on the host** as a systemd service (like cloudflared), NOT in
  Docker: `apps/terminal` (Bun workspace, deployed as a compiled
  `bun build --compile` arm64 binary by plan 011). Listens on
  `127.0.0.1:3003` only. Runs as a dedicated non-root user `pi-terminal`
  with sudo-less shell; operator escalates inside the shell if needed.
- **Sessions are tmux sessions** owned by that user: connect → attach to
  `cloud-<sessionId>` tmux session (create if absent). Disconnect leaves
  tmux running; reconnect reattaches with full scrollback. Idle tmux
  sessions reaped after 24h (tmux-side; document).
- **Auth double gate**: `apps/api` exposes `/api/ops/terminal` (superuser
  only) which mints a short-lived (30s, single-use) signed ticket; the
  browser opens `wss://api.denizlg24.com/api/ops/terminal/ws?ticket=...`;
  `apps/api` validates + proxies the WS to `127.0.0.1:3003` over the
  Tailscale/host network (apps/api container reaches host via
  `host-gateway`, wired in 011); the terminal service independently verifies
  the ticket signature (shared secret env) — defense in depth, no
  unauthenticated hop.
- **Protocol** (zod-described in `packages/schemas/src/cloud/terminal.ts`,
  consumed by 008's client): binary frames = raw pty bytes; JSON control
  frames `{t:"resize",cols,rows} | {t:"ping"} | {t:"pong"} |
  {t:"sessions"} | {t:"attach",id}`. Server: heartbeat every 15s, kill dead
  sockets after 2 missed; write-backpressure via `ws` bufferedAmount
  watermark (pause pty reads above 1MB, resume below 256KB).
- Session listing endpoint so the UI can show/attach/kill existing sessions.

## Scope

1. Scaffold `apps/terminal` workspace (Bun, no Hono needed — `ws` +
   node-pty or Bun.spawn with pty; prefer `bun-pty` if it proves stable in a
   quick spike, else node-pty; record choice). Implement design above.
2. Ticket mint/verify module shared via `@repo/cloud-core` (HMAC, jti
   single-use cache in-memory on terminal side).
3. Proxy route in `apps/api` (WS pass-through with close-code propagation).
4. systemd unit + install notes in `infra/systemd/cloud-terminal.service`
   (ExecStart the compiled binary; `User=pi-terminal`; hardening directives:
   `NoNewPrivileges`, `ProtectSystem=strict` with tmux socket path
   read-write, etc. — 011 deploys it).
5. Tests: ticket lifecycle (expiry, single-use), protocol framing round-trip
   against a real tmux in CI (ubuntu runner has tmux; skip-annotate on
   Windows dev), backpressure unit test with a flooding pty command,
   reattach-after-disconnect e2e.

## Verification

```
bunx turbo typecheck --filter=terminal --filter=api
bunx turbo test --filter=terminal --filter=api
bun run format-and-lint
# manual (Linux/WSL or CI): run service + api locally, open ws via
# scripts/terminal-smoke.ts → run `yes | head -c 10M`, confirm no
# disconnect; kill socket, reconnect, confirm scrollback intact.
```

## STOP conditions

Runbook STOPs, plus: any step tempting you to run the service in a
privileged container or as root — the design forbids it; pty library
instability on arm64 you can't resolve (report spike results).

## Drift log

- **Implementation (2026-07-24):** Added the loopback-only `apps/terminal`
  Bun service, tmux-backed attach/list/kill/reap lifecycle, 15-second
  heartbeat, two-stage output backpressure, shared 30-second HMAC tickets with
  terminal-side one-use replay protection, the superuser API mint/session
  routes and WebSocket proxy, canonical zod frames, a hardened persistent-tmux
  systemd unit, and a 10 MB reconnect smoke harness.
- **PTY choice:** `bun-pty` 0.4.10 was selected over `node-pty`; its Rust
  `portable-pty` package includes Linux ARM64/glibc and ARM64/musl libraries
  with compiled-binary embedding support. Bun 1.3.3's type package advertises
  `Bun.Terminal`, but the pinned Linux runtime does not expose the constructor,
  so the built-in spike was rejected. Backpressure pauses/resumes the
  disposable tmux attach client with `SIGSTOP`/`SIGCONT`; the tmux session and
  pane remain alive.
- **Session management contract:** `POST /api/ops/terminal` returns
  `{data:{ticket,sessionId,expiresAt}}`; `GET` and `DELETE`
  `/api/ops/terminal/sessions[/:id]` proxy one-use service tickets. Session
  listing remains available as the locked `{t:"sessions"}` WS control frame.
  Windows explicitly skips real-tmux tests; Ubuntu CI runs framing,
  flood-output, and disconnect/reattach coverage.
