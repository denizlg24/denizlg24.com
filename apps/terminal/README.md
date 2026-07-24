# Cloud terminal service

`apps/terminal` is the loopback-only, unprivileged terminal daemon for Deniz
Cloud. It runs on the host as `pi-terminal`; it must never run in the API
container, as root, with `privileged`, or with `pid: host`. Startup rejects
UID 0 even outside systemd.

The service uses `bun-pty` rather than `node-pty`. Its Rust `portable-pty`
backend ships Linux ARM64 binaries that Bun embeds into the compiled artifact,
avoiding a Node native-addon boundary while retaining a real PTY. Each
connection attaches a PTY to a tmux session named `cloud-<sessionId>`. Closing
the WebSocket only detaches that tmux client.

## Configuration

- `TERMINAL_TICKET_SECRET`: required, at least 32 bytes, and identical to the
  API value.
- `HOST`: `127.0.0.1` by default; only `127.0.0.1` and `::1` are accepted.
- `PORT`: `3003` by default.
- `SESSION_IDLE_HOURS`: `24` by default (1–168).
- `TMUX_SOCKET_NAME`: `cloud-terminal` by default.

Build and test:

```sh
bun run --cwd apps/terminal build
bun run --cwd apps/terminal test
```

Plan 011 cross-compiles the release artifact with
`--target=bun-linux-arm64` and installs it as
`/usr/local/bin/cloud-terminal`.

## Protocol and lifecycle

Binary WebSocket messages are raw PTY bytes. Text messages are the JSON control
frames defined by `@repo/schemas/cloud`: resize, ping/pong, session listing,
and attach. The service sends a heartbeat every 15 seconds and closes a client
after two missed heartbeats.

PTY output pauses above 1 MiB of WebSocket buffering and resumes below 256 KiB.
The API proxy applies the same watermarks to its upstream read. This prevents a
slow browser from moving an unbounded output buffer into either server.

The service checks tmux's session activity hourly and kills unattached sessions
idle for `SESSION_IDLE_HOURS`. tmux history is configured to 100,000 lines.
The systemd unit keeps the tmux server process and its state-directory socket
across daemon restarts, so sessions can be reattached after either a browser or
service reconnect. Operators can also list and kill sessions through the
superuser-only API endpoints.

## Manual smoke

Start the API and terminal service with the same ticket secret, authenticate a
superuser, then pass the session cookie without printing or committing it:

```sh
TERMINAL_API_URL=http://127.0.0.1:3010 \
TERMINAL_COOKIE='better-auth.session_token=...' \
bun apps/terminal/scripts/terminal-smoke.ts
```

The smoke streams 10 MB through the PTY, disconnects, mints a fresh ticket for
the same session, and verifies that shell state survives reattachment.
