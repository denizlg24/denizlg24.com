# Agents

## 0.4.0 — 2026-11-20

### Added
- A threads sidebar: every agent grouped by working directory, with search, a finished filter, and click-to-focus (⌘B).
- A resizable Changes panel for the whole app: pick any agent's repository, stage, unstage or discard per file or all at once, commit, fetch, pull and push (⇧⌘G).
- Subagents report back without polling: when one finishes, a one-line notice is typed into its parent's prompt as soon as the parent's turn ends, and `wait_for_threads` blocks once until a set of subagents is done.
- Resume a stopped session from its window or card menu (`claude --resume`, `codex resume`), keeping the same card and terminal history.
- Card menu with rename, resume, copy directory, remove, and show/hide finished subagents.
- Tile windows (⇧⌘T), focus windows by number (⌘1–9), new agent (⌘N), arrange (⇧⌘A).
- Recent working directories in the launch dialog, and an opt-in for the CLI's own native subagents.
- Dock badge for agents waiting on approval, with a bounce when one arrives while the app is in the background.

### Changed
- Delegated work now always opens real terminals: Claude's Workflow tool is blocked alongside Agent and Task, and launches append a prompt that points at `spawn_agent`.
- `get_thread` returns the thread's final reply instead of its full transcript; the transcript is opt-in and capped at its last 6,000 characters.
- Terminals use Terminal.app's Clear Dark colors and ANSI palette, SF Mono, WebGL rendering, Unicode 11 widths, Option as Meta, ⌘C/⌘K, ⌘←/→ line navigation, Shift+Enter for a newline, and file drops paste quoted paths.
- Terminal output travels as raw bytes and is polled quickly while a CLI streams, backing off when it is quiet.
- Agent trees lay out automatically: children sit centred beside their parent in their own band, so cards and connections never cross. Dragging a card switches to manual layout.
- Finished subagents fold into their parent's card instead of piling up on the canvas.
- Windows resize from every edge and corner, open on the right so the tree stays visible, and stay inside the canvas when panels open.

### Fixed
- Terminals no longer rebuild when an agent finishes or the theme changes, which reset their scroll position.
- The terminal grid no longer overflows its window: the fit addon was measuring padding it never subtracted.
- Window tabs keep a stable order; focusing a window only changes stacking.


## 0.3.0 — 2026-11-16

### Added
- In-app update checks, with a version button in the toolbar, background checks, and a restart prompt that warns about running agents.
- A Git sidebar per window with branch drift, changed files with line counts, and inline per-file diffs.

### Changed
- Agents has its own app icon instead of sharing the dashboard's.

### Fixed
- Typed input no longer duplicates in agent terminals when macOS text suggestions or autocorrect edit xterm's hidden input.

## 0.2.0 — 2026-11-15

### Added
- Persisted session records, terminal screens, canvas layout, and floating window state across restarts.
- Automatically connected MCP tools for thread messaging, delegation, and result retrieval.
- Independent Codex and Claude terminals for delegated tasks, with automatic shutdown on completion.
- Git status, diff summaries, and recent commits in terminal windows.
- Collision-aware card placement and an Arrange control for crowded agent trees.

### Fixed
- Reopening a terminal restores its screen and reads only new output.
- Failed checkpoints preserve launched session identities and report save warnings.
- Parent exits preserve independent child status, and completion/shutdown drain final transcript and terminal output.
- Inbox sequence recovery, storage failure handling, completed-window restoration, and collapsed Git polling.

## 0.1.0 — 2026-11-14

### Added
- Local Tauri canvas for Codex and Claude Code, using the shared design system.
- Model, reasoning, directory, and permission controls before launch.
- Movable and resizable terminal windows with simultaneous agent sessions.
- Connected subagent cards, live transcripts, activity, and measured usage.
- Stop removes an agent and its descendants and terminates its processes.
- Signed and notarized universal macOS releases on version bumps.
