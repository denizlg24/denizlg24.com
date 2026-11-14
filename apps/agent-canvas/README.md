# Agents

A local Tauri app for Codex and Claude Code. Uses the monorepo's shared cream/sage design tokens and UI components. Rust hosts the PTYs; the app has no server, Electron, or Node sidecar.

## Run

From the repository root:

```sh
bun install
bun run --cwd apps/agent-canvas desktop
```

Install and sign in to `codex` and/or `claude` first. The app finds CLIs on PATH, in `~/.local/bin`, `~/.bun/bin`, and Homebrew locations. CLI trust prompts, hooks, plugins, and authentication remain in effect. The launch screen defaults to your CLI permission settings; selecting YOLO (Codex) or Bypass permissions (Claude) explicitly enables the corresponding bypass flag for that session.

## Use

- Right-click the blank canvas → **New Codex agent** or **New Claude agent**. Choose a working directory, model, reasoning effort, and permission mode, then launch. Codex model choices are read from the installed CLI; custom model IDs and CLI defaults are also supported.
- Drag cards to arrange the canvas. Scroll to pan; pinch to zoom. Use the zoom/fit controls at the bottom left.
- Click a card or its expand button to open the actual CLI terminal. Expanded terminals are independent draggable, resizable windows. Keep several open, use the window strip to focus one, or maximize a window. Type prompts and commands directly into the CLI.
- Subagents appear automatically with parent connections. Click one to read its live transcript and usage. Subagents are headless CLI workers; use **Parent terminal** for interaction, including the provider's native agent-switching commands.
- **Stop** in the window title bar terminates the root CLI and its process group, removes it and every descendant from the canvas, and closes their windows. Closing the app stops its live sessions. Card positions, viewport, and theme persist locally; processes do not resume automatically after quitting.

## Usage and tracking

Input, output, cached tokens, context occupancy, and Codex rate limits come from CLI session records. Claude's reported session cost is displayed when present. Unknown values stay blank; no prices, model context sizes, or quotas are guessed. Provider-native `/usage` or `/status` commands remain available in the terminal for account details the logs do not expose.

Codex gets a separate `CODEX_HOME` per root agent under the app's local data directory. Authentication, config, instructions, skills, plugins, and rules initially link to the existing Codex home; session logs and databases remain isolated. This keeps simultaneous agents in the same directory distinct, including their recursive subagents. `--no-daemon` keeps the process owned by this app.

Claude gets a unique `--session-id` and additional per-invocation lifecycle hooks. Hooks call this app's small `--capture-hook` entry point, which atomically writes the hook's JSON to the session's local event directory. They do not edit the user's settings. Transcript reads are incremental and limited to that session and its `subagents` directory. Internal hook evaluators without a session transcript are excluded.

Tracking supports Codex JSONL rollouts and Claude Code session JSONL plus lifecycle hooks. Provider log formats can change. Native CLI output remains available even if a log field is unavailable. Terminal buffers are capped at 2 MB per root; transcripts are capped at 200 KB per card.

## Build and checks

```sh
bun run --cwd apps/agent-canvas build
cargo test --manifest-path apps/agent-canvas/src-tauri/Cargo.toml
bunx --cwd apps/agent-canvas playwright install chromium
bun run --cwd apps/agent-canvas test:e2e
bun run --cwd apps/agent-canvas tauri build --bundles app
```

On macOS the last command produces `src-tauri/target/release/bundle/macos/Agents.app`. Local builds are unsigned. The Agents GitHub Actions workflow builds signed, notarized universal macOS releases using the existing `desktop-release` environment.

Browser tests mock the native IPC boundary and cover blank canvas creation, directory selection, terminal input, connected children, usage, movement, theme, compact-window behavior, launch settings, concurrent terminal windows, drag/resize, terminal bounds, and removal of stopped agents. Rust tests cover provider parsing, usage deduplication, metadata replay, and partial JSONL records.

An opt-in debug harness exercises the same native launcher against installed, authenticated CLIs. It creates one small real model task and subagent, which consumes account usage:

```sh
cargo build --manifest-path apps/agent-canvas/src-tauri/Cargo.toml
mkdir -p /tmp/agent-canvas-smoke
git -C /tmp/agent-canvas-smoke init
apps/agent-canvas/src-tauri/target/debug/agent-canvas --smoke codex /tmp/agent-canvas-smoke /tmp/agent-canvas-codex3-report.json
apps/agent-canvas/src-tauri/target/debug/agent-canvas --smoke claude /tmp/agent-canvas-smoke /tmp/agent-canvas-claude3-report.json
AGENT_CANVAS_REPLAY_DIR=/tmp cargo test --manifest-path apps/agent-canvas/src-tauri/Cargo.toml replay_live_cli_reports -- --ignored --nocapture
```

The smoke harness trusts only the explicitly supplied test workspace and exits after at most four minutes. It is excluded from release builds.

Protocol references: [Tauri commands](https://v2.tauri.app/develop/calling-rust/), [Claude lifecycle hooks](https://code.claude.com/docs/en/hooks), [Codex CLI](https://developers.openai.com/codex/cli/reference).

## Releases

Run `bun run bump:agents patch` (or `minor` / `major`) from the repository root and fill in the new changelog entry. The helper updates the Tauri config, package manifest, Cargo manifest, Cargo lock, and Bun lock together. `bun scripts/update-agent-canvas-version.ts --check` verifies they agree.

On merge to `main`, a changed Tauri version triggers the Agents workflow. It runs frontend, browser, and native checks, then builds a universal Apple Silicon/Intel app using the same Developer ID and App Store Connect secrets as the desktop app. Missing signing material fails the release. The workflow verifies the signature and stapled notarization ticket before publishing DMG and ZIP downloads (plus a ZIP checksum) under `agents-v<version>`. Agents releases do not change the monorepo's latest release. In-app updating is not configured.

Pull requests build unsigned and never receive the release signing environment. Native tests run in the dedicated macOS workflow (`test:native` locally), so the monorepo's generic JavaScript checks do not require macOS frameworks or Linux GTK development packages.
