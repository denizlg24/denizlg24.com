# Changelog

What changed in each desktop release, newest first. Settings → Release notes
renders this file, and the GitHub release for a version opens with its entry.
Each release is a `## <version> — <YYYY-MM-DD>` heading, optionally grouped
under `### Added`, `### Changed`, `### Fixed`; inside a release only bullets,
paragraphs, **bold**, `code` and links are understood. `bun run bump:desktop
<patch|minor|major>` opens the entry for the next version.

## 3.0.0 — 2026-10-29

### Added
- **Workspace**: the app is now a set of pages built from blocks — agenda,
  tasks, alerts, notes, budget, resources, LLM spend, semester, links, to-dos,
  text and headings — laid out on a six-column grid. Home is one of them.
- A sidebar with favorites, the page tree and every module; ⌘P searches
  pages and modules together. The star in the title bar favorites whatever
  is open, page or module; every sidebar row's ⋯ menu does the same.
- The workspace follows you across machines: it opens instantly from a local
  copy and the newer of the two wins.

### Changed
- Every module rebuilt on one page system: shared headers, toolbars, lists,
  split views, property panels, stats and dialogs, in the editorial style,
  with hairlines in place of cards.
- The whiteboard has a new canvas UI: floating tool and style panels, a
  layers panel and a quieter top bar.

### Fixed
- Whiteboard selection behaves like a design tool: a click selects only what
  was clicked, Shift or ⌘ adds, a new shape becomes the selection, a small
  jitter no longer moves anything, and every drag, resize or new element is
  one undo step. Escape keeps typed text instead of discarding it, and
  shortcuts no longer fire inside sliders, menus or popovers.
- Finance no longer adds Danish kroner to euros as if they were the same
  unit. The balance chart, daily flow, category and merchant bars and the
  last-month comparison all read amounts converted at each day's rate, so a
  7,474 kr rent no longer counts as €7,474.
- A payment repaid within a week — an SU instalment paid and taken back the
  next day, a reversed card fee — no longer counts as both income and spend
  in the month's totals.
- The Lunar account shows its available balance, not the reserved amount the
  bank lists alongside it.

## 2.6.0 — 2026-10-25

### Added
- **Holdings**: the Interactive Brokers account, read-only from IBKR's daily
  statements. Value, day and total P&L, time-weighted return, value against
  deposits over time, positions, cash per currency and recent trades and
  dividends.
- Finance shows **net worth**: cash plus the brokerage account's latest value.

## 2.5.0 — 2026-10-16

### Added
- **Explored**: a world map of the ground actually walked or ridden, swept
  5 or 10 m either side of every accurate location fix, with area explored,
  distance tracked and fix count. Pans and zooms from the whole world, with
  country borders, down to street level, where OpenStreetMap streets, paths,
  water, parks and buildings are drawn in the app's theme.

### Fixed
- In-store budget messages recognise shops whose names use Danish letters.
  Føtex was never matched to its purchases, so walking in sent nothing.

## 2.4.1 — 2026-10-08

### Changed
- The macOS app is signed with a Developer ID and notarized by Apple, so it
  opens without a Gatekeeper warning. The first launch after updating asks
  for microphone access again, because the signature changed.

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

