# Agents

A local canvas for managing coding agents. Single owner; frequent desktop use alongside an editor.

## Platform
Tauri 2 desktop app (macOS first); Vite and React frontend, Rust PTY host. No server or separate JS runtime at runtime.

## Workflow
Start with an empty, pannable and zoomable canvas. Right-click to choose Codex or Claude and a working directory. Launch the installed CLI in a native PTY. Move cards, expand a terminal, and interact exclusively through the CLI. Automatically discover child agents and draw parent connections; click children to inspect their live transcript. Show activity and measured usage, preserving unknown values as unknown.

## Constraints
Use the shared @repo/ui design system. Preserve CLI authentication and approval behavior. No agent API keys, direct model calls, or chat replacement. Model, reasoning, and permission choices are applied as CLI flags; bypass is explicit and optional. Local session records remain on disk; live processes stop when the app exits. Layout persists locally.
