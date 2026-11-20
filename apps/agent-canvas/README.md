# Agents

A local Tauri app for Codex and Claude Code. Uses the monorepo's shared cream/sage design tokens and UI components. Rust hosts the PTYs; the app includes a small stdio MCP server in the same native executable, with no Electron or Node sidecar.

## Run

From the repository root:

```sh
bun install
bun run --cwd apps/agent-canvas desktop
```

Install and sign in to `codex` and/or `claude` first. The app finds CLIs on PATH, in `~/.local/bin`, `~/.bun/bin`, and Homebrew locations. CLI trust prompts, hooks, plugins, and authentication remain in effect. The launch screen defaults to your CLI permission settings; selecting YOLO (Codex) or Bypass permissions (Claude) explicitly enables the corresponding bypass flag for that session.

## Use

- Right-click the blank canvas → **New Codex agent** or **New Claude agent**. Choose a working directory, model, reasoning effort, and permission mode, then launch. Codex model choices are read from the installed CLI; custom model IDs and CLI defaults are also supported.
- **Auto layout** (on by default) keeps every agent tree arranged as it grows: children sit centred beside their parent, each subtree in its own band, so neither cards nor connections cross. Dragging a card switches to manual layout; **Arrange** (⇧⌘A) lays everything out once. Finished subagents fold into their parent's card; its "N finished" toggle shows them again. Scroll to pan; pinch to zoom.
- The **threads** sidebar (⌘B) lists every agent grouped by working directory, nested by parent, with search and a finished filter. Clicking a thread opens its window and centres its card.
- Click a card or its expand button to open the actual CLI terminal. Windows are independent, open on the right of the canvas, drag by the title bar, resize from any edge or corner, maximize on double-click, and **Tile** (⇧⌘T) into a grid. The window strip keeps a stable order: ⌘1–9 focuses a window. ⌘N starts a new agent.
- Terminals use Terminal.app's Clear Dark colors and ANSI palette in SF Mono, rendered with WebGL. Option is Meta; ⌘C copies a selection, ⌘K clears, ⌘←/→ jump to line start/end, ⌘⌫ deletes the line, Shift+Enter inserts a newline, and dropping files pastes their quoted paths.
- Right-click a card to rename it, resume a stopped session, copy its directory, show finished subagents, or stop/remove it. **Resume** restarts the same CLI session (`claude --resume`, `codex resume`) on the same card and terminal history. **Clear finished** removes every tree whose agents have all stopped.
- Delegate through the automatically connected `agent_canvas.spawn_agent` MCP tool. Each child launches the same provider in its own interactive PTY, inherits the parent's working directory, model, reasoning, and permissions, and appears with a parent connection. Its first completed turn stops the child process and closes its window; its result and saved terminal remain available for inspection. Claude's Agent, Task and Workflow tools and Codex's multi-agent features are disabled for these launches so delegates get canvas terminals; **Native subagents** in the launch dialog re-enables them for one session, and those children show as read-only transcripts.
- **Stop** in the window title bar terminates that CLI and all descendants, removes their records from the canvas, and closes their windows. Closing the app stops live sessions and saves the canvas. Session records, usage, transcripts, terminal output, card positions, viewport, theme, open windows, window sizes, and window positions survive restarts. Restored sessions are marked stopped; processes do not resume automatically.
- Terminal windows restore a saved screen and output cursor instead of replaying their history on every open. Screen checkpoints retain up to 2,000 scrollback lines; backend output retains up to 2 MB per CLI. Output since the last checkpoint is fetched incrementally.
- **Changes** (⇧⌘G, or the button in a window's title bar) opens a resizable panel on the right for any agent's repository: branch and upstream drift, staged and unstaged files with line counts and inline diffs, stage/unstage/discard per file or all at once, commit (⌘Enter), fetch, pull (fast-forward only) and push. Git never prompts: credential and editor prompts are disabled. It refreshes every four seconds.
- The Dock badge counts agents waiting on approval, and the icon bounces when one starts waiting while the app is in the background.

## Thread communication

Every launched CLI receives a per-invocation `agent_canvas` stdio MCP configuration. No global MCP settings are edited. The server supports `list_threads`, `get_thread`, `wait_for_threads`, `spawn_agent`, `send_message`, and `read_messages`.

Parents never poll. When a delegated child finishes (or exits with an error), the app types a one-line notice with the child's final reply into the parent's prompt, but only once the parent's turn has ended, so Enter can never answer an approval prompt. A parent with nothing else to do calls `wait_for_threads` once; it blocks (up to an hour; the launch raises Codex's and Claude's MCP tool timeouts to match) and returns each child's status and final reply, and children it returned are not announced again. `get_thread` returns the final reply; `include_transcript` adds the last 6,000 characters of the transcript.

Messages go to persistent per-thread inboxes. `send_message` identifies the sender from the launching CLI, and `read_messages` returns up to 100 messages with a cursor for the next read. Messages do not type into another CLI or interrupt its current turn: recipients must call `read_messages`. The server advertises this in its instructions. All managed children have independent identities and inboxes. CLI approval prompts still apply to tools.

The native executable runs this server as `--canvas-mcp DATA_DIRECTORY THREAD_ID`. Canvas records and bounded terminal output are atomically checkpointed under the Tauri local app data directory; the browser stores screen and layout checkpoints locally.

## Usage and tracking

Input, output, cached tokens, context occupancy, and Codex rate limits come from CLI session records. Claude's reported session cost is displayed when present. Unknown values stay blank; no prices, model context sizes, or quotas are guessed. Provider-native `/usage` or `/status` commands remain available in the terminal for account details the logs do not expose.

Codex gets a separate `CODEX_HOME` per root agent under the app's local data directory. Authentication, config, instructions, skills, plugins, and rules initially link to the existing Codex home; session logs and databases remain isolated. This keeps simultaneous agents in the same directory distinct, including their recursive subagents. `--no-daemon` keeps the process owned by this app.

Claude gets a unique `--session-id` and additional per-invocation lifecycle hooks. Hooks call this app's small `--capture-hook` entry point, which atomically writes the hook's JSON to the session's local event directory. They do not edit the user's settings. Transcript reads are incremental and limited to that session and its `subagents` directory. Internal hook evaluators without a session transcript are excluded.

Tracking supports Codex JSONL rollouts and Claude Code session JSONL plus lifecycle hooks. Provider log formats can change. Native CLI output remains available even if a log field is unavailable. Terminal buffers are capped at 2 MB per CLI; transcripts are capped at 200 KB per card.

## Build and checks

```sh
bun run --cwd apps/agent-canvas build
cargo test --manifest-path apps/agent-canvas/src-tauri/Cargo.toml
bunx --cwd apps/agent-canvas playwright install chromium
bun run --cwd apps/agent-canvas test:e2e
bun run --cwd apps/agent-canvas tauri build --bundles app
```

On macOS the last command produces `src-tauri/target/release/bundle/macos/Agents.app`. Local builds are unsigned. The Agents GitHub Actions workflow builds signed, notarized universal macOS releases using the existing `desktop-release` environment.

Browser tests mock the native IPC boundary and cover blank canvas creation, directory selection, terminal input, connected children, usage, movement, theme, compact-window behavior, launch settings, concurrent terminal windows, drag/resize, terminal bounds, and removal of stopped agents. Additional browser checks cover restoration after reload, terminal cursors on reopen, Git details, interactive managed children, and automatic child-window closure. Rust tests cover provider parsing, usage deduplication, metadata replay, partial JSONL records, durable canvas/output restoration, terminal paging, MCP inbox exchange, and Git status.

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
