<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Admin API (consumed by desktop and the iPhone apps)

### Session
- `GET /session` → `{ admin: true, via: "api-key" | "oauth" | "session" }` or 401 — who `requireAdmin` sees; the public blog asks it before showing moderation controls

### Workspace
- `GET /workspace/pages` → `{ pages: WorkspacePageSummary[] }` (fields, rev, blockCount; no blocks); trash older than 30 days is purged on the way
- `POST /workspace/pages` → `WorkspacePageCreate` (+ optional `markdown`) → `{ page }` 201; 409 `EXISTS` when the client-minted id is taken
- `GET /workspace/pages/{id}` → `{ page: WorkspacePageDoc }`; `PATCH` → title/icon/fullWidth/locked → `{ page }`; `DELETE` → purges a trashed page and its subtree → `{ purged }`
- `POST /workspace/pages/{id}/move` → `{ parentId, index? }`; `/archive`, `/restore` → `{ pages: summaries changed }`
- `POST /workspace/pages/{id}/ops` → `{ baseRev, ops: (insert|update|move|delete|page)[] }` → `{ page }`; 409 `CONFLICT` with `{ conflicts, page }`, 423 `LOCKED`
- `POST /workspace/unfurl` → `{ url }` → `{ bookmark: { url, title?, description?, image?, siteName } }`; 422 `UNFURL_REFUSED` for a private or non-http target
- `GET /workspace/pages/{id}/history?limit&before` → `{ revisions }`; `POST …/revert` → `{ rev }` or `{ actor, sinceRev? }`
- `GET|PUT /workspace/pages/{id}/markdown` → `{ id, rev, title, locked, markdown }` / `{ baseRev, markdown }` → `{ page }`
- `GET /workspace/changes?since=` → `{ cursor, pages: summaries, purged, prefsUpdatedAt }`
- `GET|PUT /workspace/prefs` → favorites, recents, sidebar (last write wins)
- `GET /workspace/records?refs=` → `{ records: RecordSummary[], missing }` (at most 50 `entity:<kind>:<id>` refs); `GET /workspace/records/search?q=&kind=` → `{ records }`
- `POST /workspace/views/query` → `{ view } | { pageId, blockId }` + `cursor?`, `limit?`, `today?` → `ViewQueryResult` (rows, total, groups, per-currency totals, select options); 400 `INVALID_VIEW` names a field or operator the source lacks
- `GET|PUT /workspace` → the v1 whole document, for desktop 3.0.0 only
- `GET /workspace/templates` → `{ templates: WorkspaceTemplateSummary[] }` (inputs listed); `POST` → `{ pageId, blockIds, title }` → a new template from those blocks
- `POST /workspace/templates/{id}/instantiate` → `{ parentId, title?, inputs, index? }` → `{ page }` 201; `POST …/insert` → `{ pageId, parentId?, after?, inputs }` → `{ page }`; 404 `NOT_TEMPLATE`
- `POST /workspace/buttons/run` → `{ pageId, blockId }` → `{ mode: "actions", results }` or `{ mode: "agent", run }`; `GET` with the same query → `{ run }` (the last agent run it started)
- `GET /workspace/sections?pageId&blockId` → `{ state: SectionState }`; `POST …/run` → 202 `{ state }`; `POST …/decision` → `{ pageId, blockId, decision: "accept" | "reject" }` → `{ state }`
- `GET|POST /workspace/triggers`, `PATCH|DELETE /workspace/triggers/{id}`; `GET /workspace/triggers/events?triggerId&limit` → `{ events }` with each trigger's firing outcome

Things worth knowing before touching this:

- **A page is a `WorkspacePage` document with a `rev`; every change is a
  `WorkspacePageRevision`.** The log stores ops resolved (anchors concrete,
  updates whole) plus their inverse, the block ids touched, and every 20th
  rev a full snapshot, so any past rev rebuilds from the nearest snapshot.
  Writes compare-and-set on `rev`. A purged page stays as a tombstone so the
  change feed can report it. The log is never pruned.
- **A page is a document flow of nested blocks.** Text blocks (paragraph,
  heading 1–3, bullet / numbered / todo items, toggle — a toggle heading when
  it has `level` —, callout, quote) hold inline rich text as runs: `text`
  with `bold`/`italic`/`strike`/`code`/`link`, or a `mention` of a page,
  person, date or any other record kind (`@repo/schemas` `richTextSchema`; marks are present only
  when on, so equal text compares equal). List items, toggles, callouts,
  quotes and columns have `children`; a `columns` block holds only `column`
  blocks (`width`, a share of the row), and a column cannot hold columns
  (`canContain` in `@repo/utils/workspace-tree`). Code, divider, image,
  file, bookmark, equation, table, toc, breadcrumb, synced and every widget
  are leaves. There are no spans: width comes from columns. `fullWidth`
  stays a page field.
- **Ops address blocks by id, never index, at any depth.** `insert`/`move`
  take `parentId` (absent is the page) and `after` (a sibling; absent
  appends, null is first); an insert may carry a whole subtree whose ids are
  all new; `delete` removes the subtree; `update` merges fields, never
  `children`, and its optional `type` turns a block into another keeping its
  id (its children must fit the new type). The arithmetic is
  `@repo/utils/workspace-ops`, shared by the server and the client store;
  `diffBlockTrees` turns one tree into another as ops (type changes into a
  container, placements parents-first, deletes, then field updates).
- **Rebase rule.** An older `baseRev` rebases unless a revision since
  touched a block the batch targets, or moved, deleted or replaced one of
  its ancestors — where it sits now or, for an insert/move, under the
  parent it is going to (`rebaseConflicts` in `lib/workspace/service.ts`).
  An edit to an ancestor's text is not a conflict; anchors do not count, but
  a vanished anchor or parent fails the apply and becomes one. Page-field ops
  never conflict.
- **The client store edits through ops and replays unsent ones on top of
  every server answer.** Pages load on open (`ensurePage`); the change feed is
  polled every 5 s while the window is focused and visible. Page order is a
  fractional `order` (`orderAt`), so a move rewrites one page, not its
  siblings.
- **Locked pages refuse every write from anything but the owner** (423),
  including unlocking. The owner's own session is not restricted server-side.
- **Actors: `owner`, `mcp:<clientId>`, `conversation:<id>`, `task-run:<id>`,
  `trigger:<id>`** (an event trigger's action list, written in-process).
  `lib/workspace/actor.ts` decides: any human credential (cookie, desktop
  token, API key) is `owner`; a machine token is `mcp:<clientId>` unless it
  carries `x-agent-actor`, which web's primary connector sends and the MCP
  server forwards (`apps/mcp/src/request-context.ts`). That header is
  attribution, not authorization — any service-token holder could claim one.
  Claude Code through MCP is indistinguishable from any other MCP client.
  The server itself writes as `migration` when it turns a grid into a flow.
- **Migration is lazy and idempotent, in two steps.** The first request to
  any workspace route splits the `DesktopWorkspace` singleton into pages and
  prefs; prefs are written last and mark completion; pages are insert-only,
  so a crashed or racing run finishes the same way. Each page keeps its v1
  grid in `legacyBlocks` (rev 1; the revision's `legacy` holds the v1 page)
  until its first read, which turns it into a flow as rev 2 by actor
  `migration` (`migrate` in the service, `upgradeLegacyBlocks` in
  `@repo/utils/workspace-legacy`): consecutive grid blocks pack into rows of
  6 by span, a row of more than one becomes a `columns` block whose widths
  are the spans' shares, a v1 text block becomes the blocks its markdown
  describes, a todo one todo item per entry, a heading a level-2 heading, a
  title on text or todo a level-3 heading above it. Ids are derived from the
  v1 ids, so a racing read lands on the identical page. Summaries count
  `legacyBlocks` until then. Restoring to rev 1 converts the v1 grid afresh
  with the current converter — that is how a converter fix reaches a page;
  the v1 document itself stays as the backup. Any op written against rev 1
  conflicts (the migration replaced every block).
- **Desktop 3.0.0 keeps `GET|PUT /workspace`, served a downgraded grid.**
  GET turns every flow into a valid v1 page (`downgradePage`): exactly one
  v1 block per flow block, same id — columns flatten into their blocks, each
  spanning its column's share; a plain level-2 heading stays a heading, a
  plain childless todo a todo, widgets and dividers themselves; anything
  else is a v1 `text` block holding the block's own markdown (directives and
  markers included). It records that per page as `compatBase` and stamps
  `savedAt` with the server's now (so 3.0.0 always adopts it). PUT
  (`compatMergeOps`) diffs 3.0.0's page against that base and applies a
  difference only where the stored flow, downgraded the same way, still
  reads as the base: a changed block replaces its flow block in place (an
  update when it converts back to one block of the same type, else delete
  and re-insert at the same spot), a vanished one deletes its subtree, a new
  one is converted and inserted at the top level after its predecessor.
  Span and order changes are ignored — a grid cannot say where in a flow a
  block belongs, so 3.0.0 never restructures one. A page whose merge cannot
  apply keeps what it has, whole. A page missing from the PUT is purged only
  when trashed and unchanged since 3.0.0 last held it. Prefs merge per field.
  Cost: a 3.0.0 edit that collides is silently dropped, 3.0.0 offline edits
  that never reached the server are replaced at its next launch, and 3.0.0
  shows rich blocks as raw markdown.
- **The in-app agent sees the open page.** The client sends
  `pageContext.workspacePageId`; `startAgentTurn` reads the page fresh and
  appends `<current_workspace_page>` (id, rev, locked, markdown) to the model
  messages only.
- **Markdown is lossless for its own output** (`@repo/utils/workspace-markdown`,
  inline in `workspace-rich-text`). Text blocks are plain markdown ending in
  a `<!-- id="…" -->` marker (a marker alone is an empty paragraph), list
  children indented under their item, quote children after a bare `>` line,
  toggles `<details>`/`<summary>`, callouts, columns and each column
  `:::callout{…} text` / `:::columns{…}` / `:::column{…}` directives whose
  body is their children, mentions `[@Name](person:id)`, `[@](page:id)`,
  `[@2026-10-29](date:2026-10-29)`; every other type is a
  `:::block{type id}` directive with JSON fields. Inline text is one line
  (`<br>` for a break, edge whitespace as entities). Hand-written markdown
  gets fresh ids; the migration and 3.0.0 read it leniently (an unclosed
  directive is text). `from_markdown` diffs into ops, so unchanged blocks keep
  their ids.
- **The editor is TipTap, and only `packages/admin/src/workspace/editor/`
  knows it.** `doc.ts` maps blocks ↔ ProseMirror JSON (list items wrapped in
  list nodes; a container's first paragraph is its own text; anything with
  no text to edit is one `atomBlock` with the block's fields in `data`;
  every block node carries `attrs.id` from the unique-id extension). The
  editor commits 300 ms after typing stops: the document read back as blocks
  is diffed against the last tree it agreed on and the ops go to
  `editBlocks`, which coalesces consecutive whole-block updates of one block
  and sends at most `WORKSPACE_OPS_MAX` per request. A store change it did
  not make is merged in by replacing only the top-level nodes that differ
  and putting the caret back by block id; its own pending edits are
  committed first, so a block being edited keeps the local copy and a real
  collision comes back through the store's 409. Comparisons use the
  editor's canonical form (`canonicalBlocks`) — a code run with other marks,
  say, which ProseMirror cannot hold — so a shape only an agent writes never
  reads as an edit. Turn-into (⌘/ and the "/" menu's text types) and
  inserts rewrite through the block model (`transformBlocks`). A synced
  block renders a second editor scoped to its source block; its ops go to
  the source page. Locked pages are read-only.
- **Records are `entity:<kind>:<id>`** (`@repo/schemas` `workspace-entities`:
  page, note, kanban board and card, whiteboard, person, course, envelope,
  paper, voice note, LaTeX project, calendar event). A `record` block embeds
  one as `card` or `full`; mentions take every kind. Each kind is an entry in
  `lib/workspace/records.ts` (summary and title search, server) and in
  `packages/admin/src/workspace/records.tsx` (label, icon, route, and the
  module's own `Full` component where one stands alone: a nested page, a
  note, a course's coursework, an envelope; other kinds show every field).
  Summaries are fetched in batches of 50 and cached for a minute. A missing,
  deleted or trashed record is a glyph and a dash, never an error.
- **A `view` block is a query, not data.** Its config (source, layout,
  filters ANDed, sort, group, limit, fields, dateField) lives in the block;
  markdown and 3.0.0 see only that. Each source's descriptor
  (`VIEW_SOURCES` in `workspace-views`) names its typed fields, the
  operators per type, how a row becomes an entity ref, and which fields the
  database filters (`fetch.native`). The route's loader per source
  (`lib/workspace/views.ts`) reads at most `VIEW_SCAN_CAP` (2 000) rows,
  newest first, after pushing those filters into Mongo — date windows widened
  a day each side so pushdown never drops a row the engine would keep — and
  `@repo/utils/workspace-views` does the rest: filter, sort (empties last),
  group (a multi-value row counts in each group), per-currency money totals
  (never across currencies), offset pages. Past the cap the answer says
  `truncated`. Relative date filters count from the caller's `today`; the
  calendar layout adds its month window as two extra filters.
- **Bookmark unfurling is an SSRF boundary** (`lib/workspace/unfurl.ts`).
  The socket's own DNS lookup refuses a name with any private, loopback,
  link-local or CGNAT answer (`lib/private-address.ts`, a copy of
  `apps/browser`'s list), so no rebinding window opens between check and
  connect; a literal IP is checked directly; redirects are followed by hand
  through the same guard (five at most); one 8 s deadline and 512 KB of HTML
  at most; no credentials in URLs.

### Workspace workflows (templates, buttons, agent sections, triggers)

Plan 032 phase 4. Things worth knowing before touching this:

- **The cron is external, as everywhere else.** Agent sections are AgentTasks
  and schedule triggers ride `scheduleDueAgentTaskRuns`'s route
  (`/api/jobs/agent-memory` calls `fireScheduledTriggers`); nothing in this
  repo calls that route. If the scheduler stops, no section refreshes on its
  cron and no daily note is made. "Run now" on a section and a button's
  agent prompt drain their own job in `after()` and do not wait for it.
- **A template is a page with `template: true`** (present only when true).
  It leaves the page tree (`childPages` skips template roots), mention and
  link pickers, record search and 3.0.0's grid. Instantiation is
  server-side (`@repo/utils/workspace-templates`): fresh ids at every depth,
  `{{date}}`/`{{time}}`/`{{week}}`/`{{weekday}}` in the owner's time zone,
  `{{page.title}}` the page the blocks land in, `{{input:Name}}` from the
  caller (missing → empty), filled per text run (a variable split across
  differently marked runs stays literal), in mention labels, table cells,
  captions and widget titles. Button actions, agent prompts and code are
  copied verbatim on purpose: a button's `{{date}}` means the day it is pressed.
- **Actions run through the services that own them, never HTTP back into
  web** (`lib/workspace/actions.ts`). Each is atomic on its own and reported
  per action; a failure does not stop the next and nothing rolls back.
  `$this` is the button's page; a trigger has none, and the trigger schema
  refuses `$this` and `insert-template`. `open` only does anything for a
  person's click.
- **A locked page's button still runs** — locking guards layout, not
  actions — but the actions write as whoever pressed, so a trigger's or an
  agent's write to a locked page is still a 423.
- **Workflow agent runs are incognito.** A button's agent prompt and a
  trigger's are background runs whose conversations form no evidence and
  cannot write memory; a section task runs incognito with **no connector
  tools at all** — it reads only its configured sources (records, pages as
  markdown, view rows, bounded) and its reply is the section. On top of that,
  `observeDomainRecordSafely` returns early whenever a trigger caused the
  work (`isWorkflowCaused`), so a trigger-created calendar event is not
  evidence the way the owner's own is.
- **The clobber rule: a section run never overwrites an edit.** `baseline`
  (in `workspace_sections`) is the children as the last write left them. A
  run writes only when the section is not pinned, the page is not locked and
  the children still equal the baseline (a section never written counts as
  edited unless it is blank); otherwise it stores a proposal, and the
  owner's Accept writes it as the owner. The write itself is
  `replaceChildren` with the expected children, so an edit landing between
  the run reading and writing is a 409 that becomes a proposal too. A reply
  is capped at `SECTION_BLOCKS_MAX` (60) blocks with fresh ids, and sections,
  buttons and synced blocks in it are dropped.
- **A section's task follows its block.** `reconcileSections` runs after any
  write to a page that has (or had) a section — dynamic import from the
  service's `onChange`, skipped for pages without one, because loading it on
  every write slowed the hot path enough to break the CAS race test. Tasks
  are keyed by `workspaceSection {pageId, blockId}`, hidden from the agent
  task list, paused while the page is trashed or the prompt empty, archived
  when the block goes. Edit a section through its block, never its task.
- **The loop rules.** Every event carries the trigger chain that caused it:
  in-process from `AsyncLocalStorage` (`withCausation` around a trigger's
  actions), across MCP from `x-agent-actor` looked up in
  `workflow_causations` (written when a trigger starts an agent run). A
  trigger never fires on an event whose chain contains it; nothing fires on
  an event `TRIGGER_DEPTH_MAX` (3) deep; `maxPerHour` is a fixed hourly
  window per trigger (claimed atomically; excess events are skipped, not
  queued); `TRIGGER_FAILURES_TO_DISABLE` (5) failed firings in a row turn it
  off with a `task_failed` push, and re-enabling resets the count. An agent
  trigger "succeeds" when its run is queued — the run's own failure does not
  count towards disabling. The actor header is attribution anyone with a
  service token could claim; it only ever suppresses.
- **Emit from services, and never let emitting fail the caller.**
  `emitDomainEvent` swallows its own errors; `dedupeKey` (unique, sparse)
  makes re-emits from retried jobs no-ops. events.ts loads the action
  services lazily: they emit events themselves, and a static import made a
  cycle that broke unrelated tests' module mocks.
- **Desktop 3.0.0 sees a button or a section as a v1 text block holding its
  directive** (`:::block{type="button"}` / `:::section{…}` with the children
  in its body), like every other rich block.

### Appearance, icons and components

`GET|PATCH /workspace/appearance` (+ `POST …/schedule`, `DELETE …/schedule/{id}`),
`GET|POST /workspace/themes`, `GET|PATCH|DELETE /workspace/themes/{id}`,
`GET|POST /workspace/components`, `GET|PATCH|DELETE /workspace/components/{id}`.
Schemas: `@repo/schemas` `workspace-appearance`, `workspace-themes`
(built-ins), `workspace-components`. MCP: `web_workspace_themes`,
`web_workspace_components`. UI: Settings → Appearance / Components.

- **A theme is CSS variables plus a little more**, applied to `<html>` by
  `ThemeRoot` (`packages/admin/src/workspace/appearance/`), mounted in both
  shells. Eight core colour tokens are required; the rest derive in
  `themeVariables`. Dark schemes also add `.dark`. Built-ins (`builtin:*`)
  live in code and are read-only; `builtin:sage` is the stylesheet's own
  palette. Clients poll appearance every minute and on focus, so a theme an
  agent schedules lands without a reload.
- **The schedule decides, not the default.** `activeThemeId` picks the
  latest-starting entry covering the viewer's local day, else `themeId`. A
  page's `style.themeId` overrides both while it is open; the theme editor's
  live preview overrides everything. Deleting a theme drops its schedule
  entries and resets the default if it was on.
- **Theme CSS may not fetch.** `themeCssSchema` refuses `url(`, `@import`
  and script; agents write these, and a selector-dependent fetch is how CSS
  leaks what a page shows. A background image goes through `background`, one
  fixed https URL.
- **Appearance is its own singleton, not prefs.** An older client's
  whole-prefs PUT would otherwise clobber it. The first write fills every
  field it does not name with the default — an upsert that `$set` only
  `schedule` used to store a document with no `themeId`, which read back as
  the defaults.
- **Icons are `icon:<lucide-name>[:color]` or `ri:<set>:<Name>[:color]`**
  (react-icons: brands, Font Awesome, Material, Phosphor, Tabler, …; each
  set is its own chunk, imported on first use by `react-icons.ts`), and
  emoji still render.
  `AppIcon` / `IconPicker` in `page-icon.tsx` take either; the field limit
  rose from 32 to `ICON_VALUE_MAX` (64). Module labels, icons and order come
  from appearance through `useWorkspaceNav()` (`customizeNav`), so anything
  listing modules or sections must read `sections` from the nav, not
  `MODULE_SECTIONS`.
- **A page's `style`** (cover, width, font, small text, page theme, hidden
  title) is present only when something is set (`normalizePageStyle`), like
  `template`; `replacePage` unsets it, and revert-to-rev restores it.
  `fullWidth` stays in step with `width: "full"` for desktop 3.0.0.
- **Components are custom UI elements in a library**, placed by a
  `component` block (`componentId`, prop values). `spec` is a JSON tree of
  native primitives (`spec-renderer.tsx`; the visual editor writes it);
  `html` runs in a `sandbox="allow-scripts"` iframe under a CSP with **no
  network at all** — the script is handed the owner's data, so fetch, remote
  images and forms are refused. For the same reason a spec image's `href`
  must be a literal URL: a placeholder there would carry bound data to the
  image host. Bindings (`view`, `records`, `json`) load through the normal
  view and record routes into the scope `{{path | pipe}}` reads
  (`@repo/utils/ui-spec`).
- **Theming depth:** `appearance.moduleThemes` gives a module its own theme
  while open (precedence: editor preview > page `style.themeId` > module >
  schedule > default; `ThemeRoot` tracks the module from the pathname). A
  theme's `fontImport` names a fonts.googleapis.com / fonts.bunny.net
  stylesheet and the families it adds; nothing else may be linked. `aurora`
  is a CSS layer, not the particle canvas.
- **Text tints and column alignment** are optional block fields
  (`color` / `background` on paragraphs and headings, `align` on columns),
  carried by the markdown marker / directive attrs and by node attributes in
  the editor; a tinted heading is no longer "plain" for desktop 3.0.0, so it
  downgrades to a markdown text block rather than losing its tint.
- **Component power:** a `collection` binding reads one allowlisted
  collection through `POST /workspace/data/query` (`lib/workspace/data.ts`):
  typed filter ops only (a field path cannot start with `$`), the driver
  collection so nothing is cast (id-looking strings match string or
  ObjectId), credential-looking keys stripped at any depth, 200 rows max.
  A spec `button` node with `actions` runs them through
  `POST /workspace/components/actions`: the server takes the actions from the
  stored component, never the request, hosts them on the placing block, and
  passes only the node's declared `actionVars` as `{{event.*}}`.
  `components.ts` loads the action services lazily, like `events.ts`: a static
  import made every importer load the workspace singleton for real and broke
  other suites' module mocks.
- **`embed` blocks resolve providers on render** (`@repo/utils/workspace-embeds`):
  YouTube (nocookie), Vimeo, Spotify, SoundCloud, Figma, Loom, CodePen,
  Google Docs/Maps, OpenStreetMap, direct media files; anything else is a
  frame without `allow-same-origin`. The stored URL stays the one pasted.

### Surfaces

`/workspace/surfaces[/{id}[/history|revert|state|errors|assets[/{name}]|call]]`;
schemas `@repo/schemas` `workspace-surfaces`; service
`lib/workspace/surfaces.ts`; UI `packages/admin/src/workspace/surfaces/`,
Settings → Surfaces, `/dashboard/surface?id=` (web `/surface/[id]`); MCP
`web_workspace_surfaces` (a `DIRECT_TOOLS` entry: it writes code that runs
with the whole tool bridge).

- **A surface is a whole-window app, not a block.** head/html/css/js in an
  iframe with `allow-scripts` and never `allow-same-origin`, under a CSP that
  is open on purpose (`default-src *`): any CDN, font or library. Unlike
  `html` components, which get no network because they are handed data,
  a surface asks for data itself through `window.deniz`.
- **Full liberty is the owner's decision, not an oversight.** The bridge
  (`POST …/call`) runs any tool on the primary connector by name, writes and
  destructive ones included, with no per-surface manifest and no approval.
  The prompt-injection line lives in the in-app agent's instructions and in
  `apps/mcp/src/instructions.ts`: write a surface only because Deniz asked.
  Calls reach web as actor `surface:<id>`, an agent caller, so a locked page
  refuses them.
- **The bridge is a MessagePort handed over once.** The frame may navigate
  itself (`allow-popups`, no lock), and a foreign page then lives in the same
  `contentWindow` and passes any `event.source` check. So the generated
  document's first script sends one `hello` with the build's nonce and a
  transferred port; the host accepts one hello per build and from then on
  talks only over that port, never posting to the window and never sending
  the nonce out. State and theme updates go over the port; only code or
  asset changes rebuild the frame. Code writes and their revision commit in
  one transaction (the mongo suite runs a one-node replica set for it).
- **The gate never covers Settings, and the bypass is the way back.** Home
  (the dashboard root or the home page id) or a module id from
  `moduleForPath` picks the mounted surface; at most one surface holds each
  mount and mounting takes it over. ⌘⇧E (host or forwarded from the frame),
  the corner control and the palette toggle a session bypass that does not
  depend on the frame working.
- **Code changes are revisions; mount, state and errors are not.** A change
  to a code field bumps `rev`, writes a full snapshot to
  `WorkspaceSurfaceRevision` and clears `errors`; revert restores a snapshot
  as a new rev. Runtime errors (uncaught, rejections, `console.error`) are
  POSTed by the frame and capped at 20 — they are how an agent checks its
  work. Stored as `frameErrors`: Mongoose reserves `errors`.
- **Assets** go to the `image` bucket (inline base64, multipart or a
  `sourceUrl` fetched through `fetchGuarded` in `lib/workspace/unfurl.ts`,
  the same SSRF guard as bookmarks), `{{asset:name}}` is substituted at
  render. Replacing or removing one leaves the old blob in the bucket.

### Contacts
- `GET /contacts` → `{ contacts: IContact[], stats: { pending, read, responded, archived, total } }`
- `GET /contacts/{ticketId}` → `IContact`
- `PATCH /contacts/{ticketId}` → `{ status }` or `{ emailSent }` body
- `DELETE /contacts/{ticketId}` → `{ success: true }`

### Email
- `GET /email-accounts` → `{ accounts: IEmailAccount[] }`
- `POST /email-accounts/{id}/sync` → sync inbox
- `GET /email-accounts/{id}/emails` → email list
- `GET /email-accounts/{accountId}/emails/{emailId}` → full email
- `GET /email-accounts/{accountId}/emails/{emailId}/attachments` → attachment list
- `POST /triage/bodies` → `{ triageIds: string[] }` → warms stored bodies for those rows

Bodies live in the `EmailBody` collection, written by `lib/email-body-store.ts`
and never on the `Email` document — `Email` is read in bulk by the triage
candidate scan and the inbox list, and Mongo returns whole documents. They are
stored on sync (which fetches `source`), on the triage run (which already
parsed them), and lazily on first open for anything older. Every write is
best-effort: a body that fails to store costs one slow render, and failing the
sync over it would stall `lastUid` and re-deliver the same messages.
Attachment *text* is deliberately not stored — it exists only to feed
extraction and is re-derived per run.

### Blog
- `GET /blogs` → `{ blogs: IBlog[] }`
- `POST /blogs` → `{ title, excerpt, content, tags?, media?, isActive? }` → `{ message, blog }`
- `GET /blogs/{id}` → `{ blog: IBlog }`
- `PATCH /blogs/{id}` → `{ toggleActive: true }` or full update body → `{ blog }`
- `DELETE /blogs/{id}` → `{ message }`

### Comments
- `GET /comments` → `{ comments: CommentWithBlogTitle[], stats: { total, pending, approved, deleted } }`
- `PATCH /comments/{id}` → `{ action: "approve" | "reject" }` → `{ success, comment }`
- `DELETE /comments/{id}` → `{ success, softDeleted }` (soft-deletes if has replies)

### Sub-resources (services tracked under a resource, e.g. mongodb/redis on pi-cloud)
- `GET /resources/{id}/sub-resources` → `{ subResources: (ISubResource & { uptime })[] }`
- `POST /resources/{id}/sub-resources` → `{ name, description?, isActive?, isPublic?, check }` where check is `{ type: "http", url, expectStatus?, expectJsonPath?, expectEquals? }` or `{ type: "tcp", host, port }` → `{ subResource }`
- `PATCH /resources/{id}/sub-resources/{subId}` → partial update → `{ subResource }`
- `DELETE /resources/{id}/sub-resources/{subId}` → `{ status: "deleted" }` (also deletes health logs)
- Checks run from the backend in the health-check cron (`runAllSubResourceChecks` in `lib/resource-agent.ts`); logs share `HealthCheckLog` keyed by sub-resource id; public `/api/public/resource-status` nests `subResources` per parent

### Finance budgeting (envelopes, alerts, coach)

- `GET /finance/budget` → the whole tab: envelope definitions, per-envelope
  status, unbudgeted spend, monthly totals, open alerts, open suggestions
- `GET|POST /finance/envelopes`, `PATCH|DELETE /finance/envelopes/{id}`
- `POST /finance/envelopes/{id}/contributions`, `DELETE .../{contributionId}`
- `GET|POST /finance/budget/alerts` (list | re-evaluate now),
  `PATCH /finance/budget/alerts/{id}` → acknowledge | reopen | resolve
- `GET|POST /finance/budget/suggestions` (list | regenerate),
  `PATCH /finance/budget/suggestions/{id}` → apply | dismiss. **422, not 400**,
  when a well-formed apply is refused by the state of the budget
- `GET /finance/budget/drafts` → starter limits from history, no model involved

Things worth knowing before touching this:

- **`lib/finance/fetch-budget.ts` is the provider call budget, not money.** It
  was `budget.ts` until budgeting arrived and the collision became a trap.
  Money budgeting is `envelope-math.ts` (pure arithmetic), `envelopes.ts`
  (persistence), `budget-overview.ts` (snapshot), `budget-alerts.ts`,
  `budget-coach.ts`, and `budget.ts` assembles the response.
- **A category belongs to at most one active envelope.** Otherwise the same
  transaction is charged to two plans and both read as under control while the
  money was spent once. `assertEnvelopeCategoriesFree` enforces it, including
  the single claim on uncategorized rows; Mongo cannot express it as an index.
- **Envelope spend is net of refunds.** A returned purchase did not cost
  anything, and counting the charge without the credit poisons the limit a
  little more every month.
- **Rollover is recomputed from the ledger, never stored.** A bank row landing
  late, or a recategorization, changes what an earlier period actually spent —
  a stored balance would keep asserting the old answer forever. The walk-back
  is floored at the envelope's `startDate` and capped at 24 periods.
- **`surplus` absorbs an overspend, `both` carries it.** That is the whole
  difference, and it is why `none` is the default: one bad month under `both`
  shrinks every month after it until someone intervenes.
- **A sinking fund's contributions are recorded, not observed.** Setting money
  aside is not a bank transaction, so nothing can infer it. Spend in the fund's
  categories draws it back down, which is what makes buying the thing you saved
  for show up correctly.
- **Totals are stated per calendar month, envelopes on their own cadence.**
  Adding a weekly limit to a yearly one is meaningless, so `plannedMinor` is
  the monthly equivalent of every limit plus this month's required sinking
  contributions — which is what makes it comparable to `incomeMinor`.
- **Alerts are derived and idempotent.** Each carries a `key` stable for
  (kind, envelope, period); re-running updates instead of duplicating, and
  anything not re-derived is resolved. So an open alert is currently true.
  Acknowledging records the severity at the time, so a worsening condition
  reopens it — acknowledging "projected to overspend" must not silence
  "actually overspent".
- **Two detectors read `ledger.allRows`, not `ledger.rows`.**
  `deduplicateLinkedLedger` drops `missed` rows and the projection half of a
  projection↔bank match, which is right for spend and fatal for the two alerts
  that are *about* the projection — income that never landed, and a fixed
  subscription now charging more than its rule says. Both silently found
  nothing until they were moved.
- **The coach model never sees the ledger and never does arithmetic.** It gets
  precomputed envelope status, per-category medians and open alerts, in major
  units, and every amount it proposes must be one it was given. A suggestion
  naming an envelope or category that does not exist is dropped rather than
  rendered as a button that fails when pressed.
- **Every suggestion is applicable or explicitly `advice`.** There is no third
  kind where "apply" quietly does nothing. `reallocate` converts the amount
  between the two envelopes' cadences so the annual sum is preserved.
- **Nothing may sum `amountMinor` across rows of different currencies.** A
  recurring rule, an envelope limit and a ledger row each carry their own, and
  a DKK rule was being added straight into the euro "Monthly out" as though
  100 DKK were €100. Totals are converted server-side where the dated FX
  snapshots are, and anything with no applicable rate is reported under its own
  currency rather than folded in at par — `computeRecurringCommitment` and
  `loadBudgetLedger` both return an `unconvertedByCurrency` for exactly that.
- **An envelope is always in the base currency.** Its spend is measured from
  base-converted ledger rows, so a limit in any other unit compares two
  different things. The input schema has no currency field, the sheet shows the
  base rather than offering a choice, and `rebaseEnvelope` converts any older
  row left behind by a change to the base setting.
- **A lump can prepay a rule.** `prepaidCoverage` (envelope-math) treats an
  unmatched bank row from the rule's counterparty for k × its amount (k ≥ 2,
  within 3%) as paying the next k open occurrences — three rents in one
  transfer. Matching is one-to-one, so this is derived on every read, never
  a link: covered occurrences leave `ledger.rows` (no forecast income, no
  `income_missed`) and stay in `allRows`. Counterparty identity is
  `sharesIdentity` in `core.ts`: a word of the rule's name or of anything it
  matched before, ignoring words holding digits (transfer references change
  every time, and so does the fingerprint) and words common across the
  account (`imed`, `compra`). The reconciler uses the same test.
- **`normalizedDescriptor` cannot spell Danish.** NFKD leaves `ø`/`æ` whole,
  so `Føtex` normalizes to `f tex` — no word long enough to name anyone — and
  the in-store messages never recognised his most-used shop. Match names
  through `identityDescriptor` (folds those letters) on the raw `descriptor`;
  never change `normalizeFinanceDescriptor` itself, which keys fingerprints
  and synthetic ids. The store brief also counts "common" words over distinct
  names, not rows: a fifth of his rows are Føtex.
- **Income that pays a rule has no category in the budget ledger.** The
  categorizer files a parent's transfer under "Health" happily, and an
  envelope then reads it as a refund cancelling real spend.
- **The alert pass runs at the end of `runFinanceCron` and cannot fail it.**
  The syncs already succeeded by then, and the next run re-derives the same
  alerts from the same ledger. As with markets, nothing in this repo drives
  that cron.

### Work hours and payroll
- `GET /hours` → `WorkHoursOverview`: jobs, the open shift, today/week/month totals, recent shifts, each hours-backed payout's current pay period
- `POST /hours/clock` → `{ action: "in" | "out" | "break" | "resume", jobId?, at? }`; `at` backdates. `409` when the state does not allow it (already in, not on a break)
- `GET|POST /hours/sessions`, `PATCH|DELETE /hours/sessions/{id}`; `GET|POST /hours/jobs`, `PATCH /hours/jobs/{id}` (jobs archive, never delete)
- `GET|POST /finance/deductions`, `PATCH|DELETE /finance/deductions/{id}` — reusable deduction profiles; `409` deleting one a payout still uses
- `GET /finance/rules/{id}/payouts` → every pay period with hours, gross, deduction lines, net, the reconciled bank row and variance; `PUT|DELETE /finance/rules/{id}/payouts/{date}` sets or clears an override
- The iOS home-screen app is `/admin/hours` (its own manifest at `/admin/hours/manifest.webmanifest`, like `/admin/voice`); `/admin/dashboard/hours` and desktop `/dashboard/hours` render the same `@repo/admin/hours/hours-app`

Things worth knowing before touching this:

- **A payout is a recurring rule with `payout` set, and its amount is never typed.** `materializeRecurringFinanceEntries` asks `lib/finance/payouts.ts` for each occurrence's net (hours in the period × the job's rate, minus the profile's lines, or an override) and writes it onto that occurrence's projection. `amountMinor` on the rule is rewritten to the next payout's estimate so the recurring commitment follows. Editing `amountMinor` by hand does nothing lasting.
- **The pay period ends on `cycleCloseDay` of the payout's month** (the previous month if the close day is after the payout day) and starts the day after the previous close. The *first* scheduled payout starts at `employmentStart` instead, which covers both a short first month paid on time and one rolled into the next cycle — move the rule's anchor to the first real payout date.
- **The arithmetic lives in `@repo/utils` (`payroll.ts`)**, so the rule form and the profile editor preview with the same code the server projects with. Lines apply in order; `taxable` shrinks by every earlier `reducesTaxableBase` line, and `allowanceMinor` comes off a line's base before its rate — that is how AM-bidrag and A-skat with personfradrag compose.
- **Shifts count on the job-local day they start** (`WorkSession.day`, from the job's timezone), and worked time is derived on read, never stored. Changing a job's timezone re-keys its shifts.
- **One open shift at a time**, enforced by a unique sparse index on `openKey` — a partial index cannot filter on `$exists: false`.
- **Hour changes re-project after the response** (`after()`), so a tap stays instant; a lost refresh is redone by the next projection run. Rule saves never carry overrides; the server keeps the stored ones.
- **A payout period with nothing to pay is not projected.** A zero row can never match a bank transaction and would only sit in the forecast until marked missed.

### Markets orders and margin
- `GET /markets/portfolios/{id}/orders` → `{ orders: Order[] }`; repeatable `?status=` narrows to the live book
- `POST /markets/portfolios/{id}/orders` → `OrderInput` → `{ orders }` (the entry plus any bracket legs). **422, not 400**, when the order is well-formed but refused — no buying power, no position to reduce, shorting off
- `PATCH /markets/portfolios/{id}/orders/{orderId}` → price, size and TIF only; side, type and symbol are not amendable
- `DELETE /markets/portfolios/{id}/orders/{orderId}` → cancels, and cancels any pending bracket legs beneath it

Things worth knowing before touching this:

- **Positions are signed and the invariant is `costBasis === avgCost * quantity`.** A short is a negative quantity with a negative basis, which is what makes `marketValue - costBasis` the unrealised PnL of either side with no branch. Break it and every metric silently changes meaning.
- **Shorting is opt-in per portfolio.** With `allowShorts` off, `applyTrade` clamps a sell to what is held exactly as it did before orders existed, so old portfolios replay unchanged.
- **Fills are simulated, never brokered.** `runOrderEngine` books them on the markets cron, so fill latency is the cron interval. Nothing hits `/api/jobs/markets` from inside this repo — the scheduler is external, and if it is not running, no order ever fills.
- **The trigger check reads the bar range, not just the quote.** A price that dives through a stop and recovers between two cron runs is invisible to a quote-only check, which is precisely the case a stop exists for. The placement day is excluded from that range: a daily bar has no time of day, so including it would fill a 3pm stop against the same morning's low.
- **`syncPortfolioActions` owns only `dividend`, `drip` and `split`.** `LEDGER_SOURCES` — manual, deposits, withdrawals, order fills, borrow, liquidation — is what it must never delete. Keying the cleanup on "not owner-entered" wipes the entire automated book.
- **Borrow ids are deterministic** (`borrow:<ticker>:<date>`) and upserted on `actionKey`. Charging a day twice is the failure that matters, not missing one.
- **A margin call is reported, never acted on.** `computeMargin` returns the shortfall and the UI shows it; nothing auto-liquidates, so one stale quote cannot sell the book.
- **The equity curve runs to today, not to the last cached bar.** A daily bar for today does not exist until after the close, so a curve built from bars alone stops at the previous session while positions are already live — and a portfolio opened today has no curve at all. `performanceDates()` adds inception and today; today's point is priced from the live quote.
- **The intraday curve is observed, not reconstructed.** `MarketPortfolioValuePoint` records what the book was worth whenever something priced it against live quotes, bucketed to the minute and expiring after 30 days. Rebuilding it from intraday bars would cost one relay request per holding per minute; `getPerformance` has already paid for the quotes. The series is therefore dense while something is watching and sparse otherwise, and carries no per-symbol breakdown — nothing prices a single holding minute by minute.

### Brokerage holdings

`GET /api/admin/brokerage` → `getBrokerageOverview` (`apps/web/lib/brokerage/`). The Flex statement is the source of truth; Yahoo quotes only reprice the latest snapshot on read.

Things worth knowing before touching this:

- **The Yahoo line is resolved at sync time, not on read.** `runBrokerageSync` stamps `quoteTicker`/`quoteCurrency`/`quoteScale` on the newest snapshot's positions (`resolve-quote-lines.ts`); history days and snapshots from before this existed have none and render at statement prices. Resolution never throws and never fails the sync.
- **A mapped ticker can be a dead line.** Yahoo keys secondary-currency Euronext lines as `BASE-CCY.SUFFIX`: IBKR `GOLD`/SBF/EUR maps to `GOLD.PA`, a USD line last traded in 2023, while the live EUR line is `GOLD-EUR.PA`. If the default line's quote currency differs from the position's, or its last trade is over 14 days old, `BASE-CCY.SUFFIX` is probed and used only if it is live in the right currency. An inconclusive probe (relay down, ticker skipped from a partial batch) keeps the default. Minor-unit lines (LSE GBp, JSE ZAc, TASE ILA) never use the `-CCY` form; they are quoted in pence, so `quoteScale` is 100 and the price is divided back to major units.
- **A live price is used only when the quote's currency equals `quoteCurrency` and `last` is set**; otherwise that holding stays at its statement price (`pricing: "statement"`). Quote failures or an unconfigured relay fall back to the statement silently.
- **Live NAV is the statement NAV plus the sum of live repricing deltas**, not cash plus positions, so accruals the statement carries survive. Live day P&L is the move since `prevClose` across live holdings; cumulative return stays IBKR's TWR as of the statement.
- **`getLatestBrokerageValuation` (finance net worth) still reads the statement NAV.**

### Study space (notebooks, knowledge chunks, study agent)

`/api/admin/knowledge/*` (retrieve, coverage, reindex, sources/{key}/chunks,
space) and `/api/admin/study/*` (notebooks, documents, decks, cards, review,
questions, quizzes, `notebooks/{id}/chat`). Wire types `@repo/schemas`
`study`; UI `packages/admin/src/study/` and `knowledge-graph/`; MCP
`web_study_*` and `web_knowledge`. Design: `docs/internal/plans/034-study-space.md`.

- **Every note, voice-note transcript and uploaded PDF is chunked and
  embedded; a notebook is a filter, never an index.** Chunks
  (`knowledge_chunks`) carry `sourceKey` (`note:<id>`, `document:<id>`,
  `voice-note:<id>`) and never a notebook id, so membership changes write no
  chunk. Retrieval scopes with `sourceKey: { $in }` from
  `resolveNotebookSourceKeys` — a course notebook reads `Course.noteIds` live.
- **The chunker is `@repo/utils/knowledge-chunk`, pure and structure-aware**:
  mdast sections → blocks → sentences → words, never cutting inside a word,
  math, code fence or table row; tables repeat their header; every embedded
  `text` starts with the title and heading path, which `$text` does not see
  (it indexes `body`). PDFs are rebuilt into sections from pdfjs positions
  first (`y` is `transform[5]`, unflipped). Changing boundaries or the header
  means bumping `CHUNKER_VERSION` and running
  `bun run knowledge:reindex --execute --force` — nothing sweeps on its own.
- **Reindexing rides the agent-memory job queue** (`knowledge-reindex`,
  `knowledge-projection`), drained in `after()` on enqueue and by the
  external `/api/jobs/agent-memory` tick. A new write path for note title or
  content, a transcript or a document must call `enqueueKnowledgeReindex`, and
  a delete `deleteKnowledgeSource`, or that source silently drops out of
  search. Each tick also runs `reconcileKnowledgeIndex`, which re-queues
  sources with no state row (or an `embedded` row with no chunks) and
  recreates a missing vector index — the 9 Nov restore predated the study
  space and left every source unindexed with nothing to notice. Chunk `_id`s are stable per `(sourceKey, ordinal)` and vectors are
  reused by content hash, so an edit re-embeds only what changed.
- **Retrieval is hybrid and fails soft.** `$vectorSearch` on
  `knowledge_chunks_vector_v1` fused with `$text` by reciprocal rank; if the
  vector index errors it answers lexical-only. The index is created by
  `bun run knowledge:indexes --execute` and must be READY before vector
  results appear.
- **Cards and questions are stale on read, not by flag.** They store
  `{ chunkId, sourceKey, contentHash }`; a missing chunk or a changed hash
  marks them stale in every response.
- **Study chat is always incognito and has no connectors.** The route tags the
  conversation `notebookId` and forces `memoryMode: "incognito"` before the
  turn. `notebookId` reaches tools from the route, never from the model, and
  `sourceChunkIds` the model names are kept only if the conversation retrieved
  them or they belong to the notebook. Citations are a `data-citations` part
  (`StudyCitation[]`, each with its `[n]`), stored with the message.
- **The Space graph is a cached UMAP projection.** `getKnowledgeSpace` hashes
  `(sourceKey, updatedAt)` only, returns the last projection marked `stale`
  while a job recomputes, and never loads vectors on a GET.
- **FSRS runs without fuzz** (`@repo/utils/study`), so the interval a review
  button previews is the one booked.

### Agent memory and agent tasks

- **A disagreement is not automatically a contradiction.** The formation model
  can only report that two statements disagree; `classifyTemporalConflict` in
  `lib/agent-memory/temporal-succession.ts` decides what that means. A statement
  observed later than an open-ended one supersedes it, two statements dated to
  the same instant contradict, and one describing an older state than what is
  stored is dropped as stale. Without this, every value that moves — a balance,
  a count, a role, a city — grows permanent contradiction links.
- **Undated statements need an hour of separation to count as succession.** One
  conversation disagreeing with itself is a contradiction, not a value moving.
  This is why the formation prompt pushes so hard on setting `temporal.validFrom`
  for anything that changes: a date makes the ordering explicit.
- **A less explicit statement never silently supersedes a more explicit one.**
  An inference that disagrees with something the owner stated stays a
  contradiction however much later it arrives.
- **`succession` is informational, not a review request.** It is in
  `INFORMATIONAL_REVIEW_FLAGS`, so it does not hold auto-promotion the way every
  other review flag does. Adding a flag there without that intent puts a review
  queue in front of ordinary memory formation.
- **`save_memory` writes through the candidate path, so embedding is automatic.**
  `writeRevision` enqueues the embedding job for any active revision. What the
  tool does not do is enqueue *formation* on its evidence row — the statement is
  already a finished memory, and extraction reading it back would re-derive it as
  a competing candidate.
- **Dedup happens on save, not later.** Shadow retrieval has usually just shown
  the agent the memory it is about to duplicate. A word-for-word restatement
  reinforces (evidence appended, confidence a quarter closer to 1, asymptotic);
  a restatement with a changed value supersedes; only a same-sitting
  disagreement is left as a contradiction.
- **`memoryMode` reaches tools through `ToolExecutionContext`.** An incognito
  turn must write nothing. A new memory-writing tool that ignores the context
  will happily write during incognito.
- **A task takes either `schedule` or `runAt`, never both.** They describe the
  same field — when it next fires. A spent one-off archives itself; the run stays
  in the run history.
- **Agent-scheduled tasks are ungated by decision.** Task runs execute write
  tools unattended with no approval step, so a task can schedule tasks with
  nobody in the loop. `origin` records who queued each one and the UI
  separates them; that visibility is the control, not a cap.
- **A task run is a transcript, persisted while it runs.** `AgentTaskRun.messages`
  is `AgentUIMessage[]` in the same shape as a conversation, written every ~2 s
  from `readUIMessageStream` snapshots and once more at the end, which is what
  lets the tasks page watch a run live by polling `GET /agent-tasks/runs/:id`.
  The overview list carries summaries only (`outputPreview`, `toolCallCount`);
  rows from before this carry the flat `toolCalls` audit instead, and
  `serializeAgentTaskRun` rebuilds those as tool parts so there is one renderer.
- **Nothing in this repo drives the task cron.** As with markets, the scheduler
  is external. If it is not running, no scheduled task ever fires.

### The in-app agent: AI SDK loop and connectors

Chat, background runs, scheduled tasks and the LaTeX agent all run through
`startAgentTurn` (`lib/agent/turn.ts`) → `streamAgentTurn` in `llm-service.ts`
(AI SDK v7 `streamText` over the Gateway) → a UI message stream. Its tools are
connector tools (MCP servers, `lib/connectors/`) plus a handful of built-ins
(`lib/agent/builtin-tools.ts`). Wire contract:
`docs/internal/plans/agent-connectors-refurbish.md`, "Client contract".

- **There is no step ceiling anywhere.** `streamAgentTurn` runs
  `stopWhen: () => false`, and `runToolLoop` (the single-shot Anthropic
  transport behind triage, formation and lessons) reads for as long as the
  model keeps asking; nothing carries a `maxRounds`. What that costs is
  lease-keeping: a job lease is six minutes, so `processAgentTaskJob` and
  `processBackgroundAgentJob` run inside `withMemoryJobHeartbeat`, which
  extends the job lease and the run's `executionLeaseExpiresAt` every two
  minutes. A `running` row is dead when its lease has lapsed, never because it
  is old — anything new that judges a run by `startedAt` will kill long runs.
- **A chat turn belongs to the conversation, not the request.**
  `POST /chat` claims `Conversation.activeTurn` (refused 409 while another
  live turn holds it), stores the thread as the turn starts, and runs the
  model on its own `AbortController` (`lib/agent/durable-turn.ts`) — closing
  the tab or refreshing leaves it running; the request gets one branch of a
  `tee`. The turn heartbeats the row every second with the reply so far
  (`activeTurn.message`, `seq`); 45 s without one is a dead process, and the
  next read settles its partial as `metadata.interrupted`
  (`finalizeTurn`, written straight to `messages` so a fragment is never
  observed as memory evidence). The final save releases the row in the same
  transaction (`endTurnId`).
- **Stop is `POST /chat/{id}/stop`, never just aborting the fetch.** It
  flags the row (a turn on another replica sees it at its next heartbeat),
  aborts a local one, and waits for the release, so the next send is not
  refused. A stopped reply goes through `interruptMessage`
  (`@repo/utils/agent-live`): unfinished tool calls become `output-error`,
  or `hasPendingWork` would block the thread. The iPhone dashboard and the
  web Voice page call it too.
- **Resume is `GET /chat/{id}/stream`, snapshot patches, not chunk replay.**
  Events are `agentLiveEventSchema`: a patch replaces the message's parts
  from `start` on and the first one is always the whole message, so a client
  holding any partial copy lands on the same reply; `seq` drops replays. The
  running process pushes snapshots from memory (`live-turns.ts`, per
  process); any other replica polls the row. `GET /conversations/{id}`
  merges the partial in and returns `activeTurn`, which the session follows.
  The desktop and admin reopen the last thread for 12 h after a restart.
- **The queue lives on the conversation** (`queue`, at most 20;
  `POST|DELETE /conversations/{id}/queue`). The client sends the head as
  its own turn with `queuedMessageId`, which leaves the queue once the turn
  claims the thread; a stop pauses it. A user message re-sent with the id of
  the stored last message is a retry, never a second copy.
- **`ask_user` is a client tool like the page tools** (`isAgentClientTool`),
  offered only when the request says `questions: true` and the turn is
  interactive. The answer is its output and continues the same assistant
  message; `merge.ts` reads anything not matching
  `agentQuestionOutputSchema` as `{ dismissed: true }`.
- **The server owns the thread.** The client sends only the last message.
  A user message keeps only text and file parts; an assistant message is a
  continuation from which `lib/agent/merge.ts` copies approval decisions for
  approval ids the stored message is actually waiting on, and outputs for the
  three page tools — nothing else. That is what makes a forged approval or a
  rewritten tool input impossible without `experimental_toolApprovalSecret`.
- **Conversations store `UIMessage[]` (`format: "ui"`).** A row without
  `format` predates the loop and is Anthropic-shaped; `storedMessagesToUI`
  converts it on read, the next save rewrites it, and
  `bun run conversations:migrate` (dry-run unless `--apply`) settles the rest.
  Page context and recalled memory images are appended to the model messages
  only (`lib/agent/model-messages.ts`) and never stored.
- **Evidence is derived per part, with ids stable across saves.** One UI
  message spans every step of a turn and is re-saved as it grows, so
  `agentEvidenceUnits` maps it onto the old one-row-per-turn shape
  (`<id>:text:<index>`, `<id>:tool:<callId>`) and `saveConversationMessages`
  observes only units the previous save did not have. User message ids are the
  client's; converted legacy messages keep their event ids.
- **Approval is `lib/agent/approval.ts`, per call.** A connector call runs
  unasked only when the chosen action (or the tool) is read-only and the
  connector's policy is `reads-auto`; `always-ask` / `never-ask` override; YOLO
  runs everything. Built-in writes (`save_memory`) ask in interactive mode. An
  incognito turn denies every write to `web_agent_memory*` on the primary
  connector — the MCP server cannot see the turn's memory mode, so the policy
  is the only thing holding that line.
- **The primary connector is a seeded row, `slug: "denizlg24"`, `auth:
  "service"`.** Its URL and credentials come from the environment on every
  call (`WEB_MCP_OAUTH_CLIENT_ID/SECRET`, a `service` client with only the MCP
  resource; `MCP_CONNECTOR_URL`, which also sets the resource, and
  `MCP_CONNECTOR_ISSUER` point a dev web at the production server). Never put
  a production `OAUTH_RESOURCE_MCP` in the root `.env` for this: the local API
  and MCP read that one. Unset leaves it `unconfigured` and chat runs on the
  built-ins. Only its approval, enabled flag and disabled tools are editable.
- **Third-party connectors are `none`, `bearer` or `oauth`.** OAuth is the MCP
  flow through `@ai-sdk/mcp` `auth()` with `ConnectorOAuthProvider`: tokens,
  registered client and PKCE verifier are sealed with `IMAP_ENCRYPTION_KEY`;
  the pending `state` is stored only as a hash, and the public callback
  `/api/connectors/oauth/callback` finds the row by that hash while it is
  unexpired. Redirects stay at the SDK's `'error'` default so a server cannot
  bounce a bearer token to another host. A third party's `instructions` go
  into the prompt marked `data-not-instructions`; ours do not.
- **`tools/list` is cached on the connector for 30 minutes**, and a client is
  opened only when the model first calls one of its tools. Tool names are
  `<slug>__<tool>` (hashed past 64 characters). A connector result is cut at
  48 000 characters with a note telling the model to narrow the request.
  The client sends a schema's `x-mcp-header` arguments as `Mcp-Param-*`
  headers only for definitions it has itself listed, so the per-turn client is
  primed from the cache (`primeToolHeaderBindings`) before its first call —
  GitHub's servers refuse `owner`/`repo` calls without them, and a
  `callTool` on an unprimed client fails with "missing Mcp-Param-… header".
- **The primary connector hands the model its compact surface, not every
  tool.** The cache keeps the full listing (triage's catalogue and the
  connector settings read it); `selectToolSurface` exposes the
  `compact`-marked tools and binds the rest as `catalogTargets` of the
  catalog call tools. A listing without `catalog_read` (an older MCP server)
  is exposed whole, so neither app has to deploy first.
  `MCP_CONNECTOR_TOOL_SURFACE=full` restores every tool per turn (≈116k
  tokens against ≈5k).
- **A catalog call is approved as the operation it names.** `resolveCall` in
  `approval.ts` judges `{resource, operation}` by that resource's own
  binding (and the call tool's flags on top), so reads-auto, the Destructive
  reason and the incognito `web_agent_memory*` guard hold exactly as by name.
  A resource missing from `catalogTargets` — disabled in `disabledTools` or
  unknown — is `denied` before anything runs, YOLO included. Triage never
  sees the catalog tools: its allowlist is `web_*` names.
- **Web search and fetch are provider tools.** Anthropic models get
  Anthropic's `web_search` / `web_fetch`; anything else searches through the
  Gateway's Perplexity tool and has no fetch. "Think longer" is `effort: max`
  on adaptive-thinking models and `reasoning: "xhigh"` elsewhere.
- **The LaTeX agent proposes edits as tool calls.** `propose_change` validates
  one change against the loaded project and returns `{ proposal, status }`;
  the proposal id is the tool call id, and `PATCH …/agent` records the user's
  decision on that output. Nothing the agent does writes a file.

### Authenticator
- `GET /authenticator` → `{ accounts: IAuthenticatorAccount[] }` (no secrets)
- `GET /authenticator/codes` → `{ codes: IAuthenticatorCode[] }` — server-computed, used by the admin and desktop UIs
- `GET /authenticator/export` → `{ accounts: IAuthenticatorExportAccount[], exportedAt }` — **the only route that returns decrypted base32 secrets.** It exists so `apps/authenticator-extension` can hold an offline vault; a leaked API key here costs every secret, not one code. Do not call it from the web or desktop UIs, and do not persist its response anywhere unencrypted.
- `POST /authenticator` → `{ label, issuer, accountName, secret, algorithm?, digits?, period? }` → `{ account }`
- `PATCH /authenticator/{id}` → label/issuer/accountName only; a secret is never updated in place
- `DELETE /authenticator/{id}` → `{ success: true }`

### Voice notes
- `GET /voice-notes` → summaries (no transcript body); filters `q`, `status`/`source`/`tag`/`groupId`/`contextId` (repeatable, any-of), `context=any|none`, `linked`, `from`/`to` on `recordedAt`, `sort`, `limit`/`offset` → `{ voiceNotes, total, totalDurationMs }`
- `GET /voice-notes/facets`, `GET /voice-notes/{id}` (transcript + segments), `PATCH /voice-notes/{id}` → `{ title?, tags?, context?: {kind,id} | null | "auto" }`, `GET /voice-notes/{id}/context-candidates`
- Design: `docs/internal/plans/023-voice-notes-overhaul.md`

- **Any `/api/admin` body over `proxyClientMaxBodySize` is silently truncated.**
  `proxy.ts` matches `/api/admin/:path*`, and Next clones a proxied body only
  up to that limit before handing the rest of the request to the route — which
  then fails to parse a multipart it cannot see the end of. It is `260mb` in
  `next.config.ts` for voice notes; at the 10 MB default every recording over
  ~27 minutes was a 500 and the recorder dropped the audio.
- **`gpt-transcribe` answers a long request with `500 Audio file processing
  failed`.** Every recording ≥ 39 min failed and every one ≤ 19 min worked, at
  any size under 25 MB. Voice notes are cut into 300 s pieces with the static
  ffmpeg in the web image (`FFMPEG_PATH`) and transcribed in order, each with
  the previous text's tail as `prompt`; every piece lands in
  `transcription.segments` as it finishes, so a retry resumes. Dictation
  (`/voice-notes/transcribe`) is still one request and still has the ceiling.
- **The desktop web view ignores `audioBitsPerSecond`.** It asks for 24 kbps
  and writes ~50 kbps, so size limits reached twice as early as their comment
  said.
- **`context` is derived once, at save.** A timed calendar event overlapping
  the recording wins, else the active timetable slot for that local weekday;
  overlap must be ≥ min(10 min, half the recording). `contextSource: "manual"`
  (set or cleared by hand) is never re-derived; an upload with no `recordedAt`
  is never linked. Groups are not stored — they are read through linked notes.

### Upload
- `POST /upload` → FormData with "file" field → `{ url, hash }`. Stores to the self-hosted cloud S3 via `uploadFileToStorage(file, "image")`, where `"image"` is the bucket name, not a type filter — the route enforces no type or size limit. Pinata is gone — the spreadsheets routes read and write the same self-hosted storage, and only their `pinata*` column names survive.

### CV
- `GET /cv` → `{ cv: ICvFile | null, project: LatexProject | null }` (metadata and LaTeX source are stored on the AppSettings singleton)
- `GET /cv/file` → PDF bytes proxied from storage (admin preview renders these via react-pdf; webviews can't embed remote PDFs natively)
- `PUT /cv` → validates and saves a multi-file LaTeX project draft without publishing it
- `POST /cv/compile` → validates and compiles the LaTeX project with sandboxed Tectonic, uploads the generated PDF to the storage `file` bucket, persists source and metadata, and revalidates `/`. Answers as `text/event-stream` (`latexCompileEventSchema`): `log` chunks while Tectonic runs, then one `done` (`payload` = the old JSON body) or `error` carrying the pre-stream HTTP `status`, the full log and parsed `diagnostics`. `POST /latex/projects/{id}/compile` streams the same way; `packages/admin/src/latex/compile-stream.ts` is the reader both pages use
- `POST /cv` remains as the legacy PDF upload endpoint; `POST /cv/publish` revalidates the public page separately
- The reusable editor workspace lives in `packages/latex-editor`; it supports files, folders, tabs, binary assets, a compile log, and a PDF preview slot
- Public homepage resume button reads the stored URL via `lib/cv.ts` `getCvUrl()`, falling back to the bundled `/assets/DenizGunesCV2026.pdf`; shared admin UI is `packages/admin/src/cv/cv-page.tsx`

### LLM Usage
- `GET /llm/usage` → usage stats, breakdowns, recent requests
- `GET /llm/models` → `{ models: LlmCatalogModel[], stale, fetchedAt }` — Vercel AI Gateway language-model catalog (fully qualified ids like `anthropic/claude-haiku-4.5`, capability tags, context/output limits); filters: `?creator=` and repeatable `?requiredCapability=`; 503 when the catalog is cold
- All server LLM traffic goes through `apps/web/lib/llm-service.ts` (Vercel AI Gateway; `AI_GATEWAY_API_KEY`). Never import a provider SDK or build provider URLs in app code — add operations to the service instead. Model ids are fully qualified Gateway ids; legacy dashed ids resolve via the service's alias map. The agent loop's AI SDK models and provider tools come from `lib/llm-transports/ai-gateway.ts`; single-shot operations (triage, formation, classification) still use the Anthropic-compatible transport.
- **Two documented exceptions**, both shaped the same way: the provider call
  lives in a single `lib/llm-transports/*` module, app code still only calls
  `llm-service`, and because neither model is in the Gateway catalog its pricing
  is a hand-maintained constant in `llm-service.ts` rather than resolved live.
  A stale rate shows up as wrong spend in usage reporting, not as a failure.
  - `embedMultimodal()` → Cohere via `cohere-embeddings.ts` (`COHERE_API_KEY`).
    The Gateway's `/v1/embeddings` validates the OpenAI-shaped `input` field and
    drops Cohere's `inputs`/`images`, so multimodal embedding is unreachable
    through it — every Gateway embedding model reports text-only input. See
    `docs/internal/plans/attachment-memory.md`.
  - `transcribeAudio()` → OpenAI via `openai-transcription.ts`
    (`OPENAI_API_KEY`). The Gateway exposes no speech-to-text route at all and
    its catalog lists only language and embedding models. Model set by
    `VOICE_TRANSCRIPTION_MODEL`. OpenAI bills transcription two ways — newer
    models per token with audio and text metered separately, `whisper-1` per
    minute — and `OPENAI_TRANSCRIPTION_PRICING` covers both; an id missing from
    it still transcribes but logs $0 and warns.
- Do not widen either exception without the same kind of evidence: an operation
  the Gateway genuinely cannot carry, not one that is merely inconvenient.

### System One evaluations (Jev)

`evaluateQuestions()` in `llm-service` asks `typesafe-ai/jev` typed questions
against one shared state and gets typed values with probability distributions
back — no text, no parsing, and no answer outside the options given. It is a
Gateway call like any other (`AI_GATEWAY_API_KEY`), through
`lib/llm-transports/jev-evaluate.ts`; it needs its own transport only because
`experimental_evaluate` takes an evaluation model rather than a language one.
`JEV_MODEL_ID` pins a revision. Design: `docs/internal/plans/025-jev-system-one-evaluations.md`.

- **Confidence is the margin, not the top probability.** The Gateway's response
  carries `probabilities` and no confidence field, so `jevConfidence` in
  `@repo/schemas` defines it as the gap between the winner and the runner-up —
  0.5 is decisive between two options and a coin toss between seven, which is
  why top-1 cannot be the gate. A missing distribution reads as undecided, never
  as certain. `jevIsTrue` needs P(true) ≥ 0.5 *and* a decided margin, because a
  Noul's probability is not a measure of degree.
- **Four sites, all live, all fail open.** Triage adjudicates only the rows
  already bound for the review queue (`triage-adjudicator.ts`); formation
  re-decides a candidate's typed fields and lowers its self-reported
  confidence to measured support (`agent-memory/evaluation.ts`); the status
  collector asks for a verdict before spending a full agent run
  (`apps/status/lib/jev.ts`). Every one returns null on any failure and the
  caller carries on exactly as it did before — a memory run must never fail
  because a second opinion was unavailable.
- **Formation's adoption is asymmetric on purpose.** `confidence` is the
  *lower* of the stated and measured values, `explicitness` only ever moves
  *down*, `sensitivity` only ever *up*; `memoryType` is taken outright because
  it steers retrieval, not promotion. A second opinion may hold a candidate
  back and must never wave one through into auto-promotion — a measurement
  that raised confidence would do exactly that. Both inputs survive as
  `extraction.statedConfidence` and `extraction.evaluatedConfidence`.
- **Only `transient` skips a triage run.** `operational` and `code` are the
  verdicts that need the agent, and Jev has no tools to act with.
- **Jev's rate is a hand-maintained constant** (`JEV_PRICING`), like the
  transcription rates, because the Gateway catalog lists only language and
  embedding models. Free until 2026-09-25; a stale rate is wrong spend in usage
  reporting, not a failure.
- `apps/status` reads `AI_GATEWAY_API_KEY` from `.env.status`, not the root env.
