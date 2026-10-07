# Changelog

What changed in each desktop release, newest first. Settings → Release notes
renders this file, and the GitHub release for a version opens with its entry.
Each release is a `## <version> — <YYYY-MM-DD>` heading, optionally grouped
under `### Added`, `### Changed`, `### Fixed`; inside a release only bullets,
paragraphs, **bold**, `code` and links are understood. `bun run bump:desktop
<patch|minor|major>` opens the entry for the next version.

## 2.4.0 — 2026-10-07

### Added
- Triage proposes changes to the rest of the app alongside tasks and events:
  adding, updating or removing people, finance rules, notes and anything else
  the denizlg24 MCP server exposes. Each proposal shows the exact call and its
  arguments, and runs only when accepted; proposals are never auto-accepted.

## 2.3.3 — 2026-10-05

### Added
- **Release notes** in Settings, rendered from `apps/desktop/CHANGELOG.md`.

### Changed
- Hours: the shared hours app is reworked for small screens, with a sheet for
  editing shifts and a dedicated time field.
- GitHub releases list only the pull requests that touched the desktop app,
  the web app or the shared admin package.

