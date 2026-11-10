# Changelog

What changed in each desktop release, newest first. Settings → Release notes
renders this file, and the GitHub release for a version opens with its entry.
Each release is a `## <version> — <YYYY-MM-DD>` heading, optionally grouped
under `### Added`, `### Changed`, `### Fixed`; inside a release only bullets,
paragraphs, **bold**, `code` and links are understood. `bun run bump:desktop
<patch|minor|major>` opens the entry for the next version.

## 3.3.1 — 2026-11-10

### Fixed
- **Sprints**: a coding run no longer fails as "exited -1 without a result"
  once it passes two minutes; the runner was giving up on the container it
  was waiting for.
- **Agent memory**: the chat agent's `save_memory` saves again. Every call
  had been refused as "Actor agent is invalid for manual evidence".

### Changed
- The LaTeX editor's grammar checker moves to Harper 3, along with the
  month's minor dependency updates.

## 3.3.0 — 2026-11-07

### Added
- **Sprints**: plan scheduled coding-agent runs against a repository. A
  sprint is a branch and a pull request; its slots (implement, review,
  fix-review, release, custom) sit on a day-by-hour timeline, chain through
  dependencies, and run Claude Code headless on Forge at their time. Drag a
  slot to move it, click empty time to add one.
- **Sprint editors are prompt boxes**: a slot's task, a sprint's goal and its
  default instructions are written in one composer, with model, effort,
  permissions, credential, timeout and instructions as pills beneath it. On a
  slot, a pill left on the sprint's value stays quiet and follows the sprint;
  kind, time, upstream slots and the upstream wait sit as pills above. The
  model pill searches the catalogue or takes any Claude Code id.
- **Coding runs**: each run's transcript, result, review findings by
  severity, cost (`~$` when it is a subscription estimate), branch, PR and CI,
  live while it runs, with cancel and retry. The transcript opens with the
  task and the settings the run actually used.
- **Release offers**: a release slot that passes CI offers its pull request
  for merging; Merge on the sprint merges exactly the commit CI saw.
- **Calendar**: sprint slots show on the month grid, linking to their sprint.

## 3.2.0 — 2026-11-02

### Added
- **Themes**: built-in themes (Sage, Sage night, Paper, Graphite, Midnight,
  Fjord, Rose, Terminal, Christmas, Autumn, Spring) and your own, made in
  Settings → Appearance with a live preview: colours, light or dark, corner
  radius, body and heading fonts, webfonts from Google Fonts or Bunny Fonts,
  a background image, extra CSS, ornaments beside page titles and in the
  sidebar, and ambient effects (snow, leaves, petals, hearts, stars,
  confetti, rain, fireflies, bubbles, sparkles, aurora).
- **Theme schedule**: put a theme on for a date range and it switches back by
  itself. A page or a module can wear its own theme. ⌘P switches themes.
- **Agents make themes and UI**: the agent can create, edit and schedule
  themes ("make it Christmas until January") and build components.
- **Icons instead of emojis**: pages, callouts, components and sidebar
  modules take a searchable icon in any colour, from Lucide or the
  react-icons libraries (brand logos, Font Awesome, Material, Phosphor,
  Tabler and more). Existing emojis keep working.
- **Page styling**: covers (gradients, a colour or an image you can
  reposition), width, font, small text, hidden title or header.
- **Block colours**: text and background tints on paragraphs and headings;
  vertical alignment for columns.
- **Sidebar**: rename, re-icon and reorder modules and sections; text size
  and density.
- **Embeds**: YouTube, Vimeo, Spotify, SoundCloud, Figma, Loom, CodePen,
  Google Docs and Maps, OpenStreetMap, video and audio files, or any page.
- **Components**: custom UI elements built visually, as JSON or as HTML, fed
  by views, records or any of 30 collections, with buttons that run actions
  (add a card, tick a to-do, append to the page). Settings → Components holds
  the library.
- **More records**: blog posts, projects, contacts, emails, finance accounts,
  entries and rules, journal, spreadsheets, resources, groups, agent tasks,
  coursework, jobs, timetable, portfolios and watchlists can be embedded,
  mentioned and shown in views.

### Fixed
- Record cards and widgets (course notes, the deadline radar) no longer stay
  on their loading skeleton.

## 3.1.0 — 2026-10-30

### Added
- **Pages are documents**: write in a flowing editor instead of a grid.
  Paragraphs, headings, bulleted, numbered and to-do lists, toggles,
  callouts, quotes, code, images, files, bookmarks, equations, tables, a
  table of contents, breadcrumbs and synced blocks, nested where they make
  sense, side by side in columns. The widgets from 3.0.0 are blocks in the
  same flow.
- "/" or the **+** beside any block opens every block type; ⌘/ turns a
  block into another; drag handles move blocks into and out of columns;
  `@` mentions pages, people, dates and records.
- **Embeds**: any note, board, card, whiteboard, person, course, envelope,
  paper, voice note, LaTeX project, event or page — as a mention, a card or
  its full view.
- **Views**: kanban cards, events, notes, finance entries, coursework,
  people, triage, agent tasks, papers and voice notes, filtered, sorted and
  grouped, as a table, list, board, calendar or gallery. Money totals stay
  per currency.
- **Templates** with variables and prompted inputs, from the sidebar's new
  page menu or "/".
- **Buttons** that run a list of actions or an agent prompt against the page.
- **Agent sections**: a block an agent rewrites on a schedule or on demand.
  If you edited it since the last run, the run proposes instead of
  overwriting.
- **Triggers**: when a card moves, an event is created, mail is triaged, a
  payout lands, a voice note is transcribed or a page is created, run
  actions or an agent prompt. Daily notes are a scheduled trigger.
- Page history: every change is recorded with who made it, and a page can be
  reverted to any revision or have one agent's changes undone.

### Changed
- The workspace is stored per page on the server. Edits sync as they are
  made and show up in other open windows within seconds, including the web
  dashboard and agent edits. The local copy is only a cache for launch.
- Existing pages convert from the grid on first open; side-by-side blocks
  become columns.
- Agents can read and edit pages, as markdown or block by block.

### Fixed
- Opening a page no longer leaves a block selected.

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

