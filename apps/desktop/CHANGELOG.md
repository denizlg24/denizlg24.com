# Changelog

What changed in each desktop release, newest first. Settings → Release notes
renders this file, and the GitHub release for a version opens with its entry.
Each release is a `## <version> — <YYYY-MM-DD>` heading, optionally grouped
under `### Added`, `### Changed`, `### Fixed`; inside a release only bullets,
paragraphs, **bold**, `code` and links are understood. `bun run bump:desktop
<patch|minor|major>` opens the entry for the next version.

## 2.3.3 — 2026-10-05

### Added
- **Release notes** in Settings, rendered from `apps/desktop/CHANGELOG.md`.

### Changed
- Hours: the shared hours app is reworked for small screens, with a sheet for
  editing shifts and a dedicated time field.
- GitHub releases list only the pull requests that touched the desktop app,
  the web app or the shared admin package.

