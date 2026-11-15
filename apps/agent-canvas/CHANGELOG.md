# Agents

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
