# denizlg24.com Monorepo

## What this is

A personal "life OS" with exactly one user: Deniz, who is the owner, the only
admin, and the only person who ever sees any of it. The public portfolio site at
denizlg24.com is the only outward-facing surface; everything else — the `/admin`
dashboard in apps/web and the entire desktop app — is a private cockpit for
running Deniz's own life and infrastructure: contacts, email, blog, projects,
calendar, notes, kanban, resource/uptime monitoring, LLM usage, and an
agent-memory system that forms, consolidates, and retrieves memories about him
from his own data.

Consequences of being single-user — these are hard rules for UI work:

- **No explanatory copy.** Never add onboarding text, feature descriptions,
  "how it works" blurbs, tooltips that explain mechanics, or marketing-style
  labels. The owner built the feature; the UI assumes full context. Empty
  states stay empty or show a bare count/dash, not instructions.
- **Terse, data-dense surfaces win.** Prefer showing one more piece of data
  over a sentence of prose.
- **No multi-tenant thinking.** No roles, no per-user settings, no "your
  account" language. Auth is a single admin gate; module-level caches keyed per
  session (not per user) are fine.

## Structure

Turborepo monorepo (bun workspaces, single root `bun.lock`, Biome lint/format at root).

- `apps/web/` (formerly `portfolio-2026/`) — Next.js admin dashboard + API (backend). Manages portfolio content, contacts, blog, projects, email, calendar, etc. Uses MongoDB, shadcn/ui, Tailwind.
- `apps/desktop/` (formerly `denizlg24-app/`) — Tauri + Next.js desktop app (client). Consumes the web app's API. Minimalist/editorial design.
- `packages/typescript-config/` — shared tsconfig presets.
- `_archive/` — the original standalone repos with full git history (gitignored; read-only rollback material).

Tasks run through turbo: `bunx turbo build | typecheck | test | dev [--filter=web|desktop]`; `bun run format-and-lint` at root.

## apps/desktop Architecture

### Stack
- Next.js 16 + React 19 + TypeScript (strict)
- Tauri desktop wrapper (uses `@tauri-apps/plugin-http` for fetch)
- Tailwind CSS v4 + shadcn/ui (Radix primitives) + lucide-react icons
- TanStack react-table for data tables
- Zustand for state, sonner for toasts
- Package manager: **bun** (never npm)

### Key Patterns

**API calls**: `denizApi` class in `lib/api-wrapper.ts`. Base URL: `https://denizlg24.com/api/admin`. Auth via Bearer token.
```ts
const api = useMemo(() => {
  if (loadingSettings) return null;
  return new denizApi(settings.apiKey);
}, [settings, loadingSettings]);

const result = await api.GET<T>({ endpoint: "..." });
if (!("code" in result)) { /* success */ }
```

**Page structure**: `"use client"` pages in `app/dashboard/{feature}/page.tsx`. Sub-components in `_components/`. Header bar pattern: icon + title + actions in `h-12 border-b` container.

**Loading**: Content-shaped `<Skeleton>` components matching final layout. See `ContactsLoadingSkeleton` or `UsageLoadingSkeleton` for reference.

**Data tables**: Inline `DataTable` component using TanStack react-table with `SortHeader` helper. Pattern in `llm-usage/page.tsx` and `contacts/page.tsx`.

**Error handling**: Union return `T | AuthError | ApiError`. Check `"code" in result` for errors. Optimistic updates with rollback on failure.

**Styling**: Minimalist/editorial. Small text (`text-xs`, `text-sm`). Muted foreground for secondary info. `tabular-nums` for numeric data. Badge variants for status. Line-variant tabs for filters.

### UI Components Available
All in `components/ui/`: accordion, alert, alert-dialog, avatar, badge, button, card, carousel, chart, checkbox, collapsible, combobox, command, context-menu, dialog, drawer, dropdown-menu, form, input, label, popover, progress, scroll-area, select, separator, sheet, skeleton, slider, table, tabs, textarea, toggle, tooltip, sidebar, sonner (toasts).

### Navigation
Sidebar groups defined in `components/navigation/navigation-menu.tsx`. Routes registered in `context/user-context.tsx` `KNOWN_ROUTES` set.

### Type Definitions
Canonical API contract lives in `packages/schemas` (zod schemas; all TS types are `z.infer`): IContact, IEmail, IBlog, IProject, ICalendarEvent, ITimetableEntry, IWhiteboard, IKanbanBoard, IKanbanCard, IConversation, IResource, etc. Desktop's `lib/data-types.ts` is a re-export shim (plus desktop-only UI-state types). Change schemas FIRST; `turbo typecheck` surfaces both apps' breakages. Don't reintroduce local wire types or hand-written response interfaces.

## apps/web API Endpoints (consumed by apps/desktop)

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

### Upload
- `POST /upload` → FormData with "file" field → `{ url, hash }` (Pinata, images only, max 5MB)

### CV
- `GET /cv` → `{ cv: ICvFile | null, project: LatexProject | null }` (metadata and LaTeX source are stored on the AppSettings singleton)
- `GET /cv/file` → PDF bytes proxied from storage (admin preview renders these via react-pdf; webviews can't embed remote PDFs natively)
- `PUT /cv` → validates and saves a multi-file LaTeX project draft without publishing it
- `POST /cv/compile` → validates and compiles the LaTeX project with sandboxed Tectonic, uploads the generated PDF to the storage `file` bucket, persists source and metadata, and revalidates `/`
- `POST /cv` remains as the legacy PDF upload endpoint
- The reusable editor workspace lives in `packages/latex-editor`; it supports files, folders, tabs, binary assets, a compile log, and a PDF preview slot
- Public homepage resume button reads the stored URL via `lib/cv.ts` `getCvUrl()`, falling back to the bundled `/assets/DenizGunesCV2026.pdf`; shared admin UI is `packages/admin/src/cv/cv-page.tsx`

### LLM Usage
- `GET /llm/usage` → usage stats, breakdowns, recent requests
- `GET /llm/models` → `{ models: LlmCatalogModel[], stale, fetchedAt }` — Vercel AI Gateway language-model catalog (fully qualified ids like `anthropic/claude-haiku-4.5`, capability tags, context/output limits); filters: `?creator=` and repeatable `?requiredCapability=`; 503 when the catalog is cold
- All server LLM traffic goes through `apps/web/lib/llm-service.ts` (Vercel AI Gateway; `AI_GATEWAY_API_KEY`). Never import a provider SDK or build provider URLs in app code — add operations to the service instead. Model ids are fully qualified Gateway ids; legacy dashed ids resolve via the service's alias map.

## Porting Features from apps/web

When porting features to apps/desktop:
1. Use apps/desktop's existing patterns (api wrapper, loading skeletons, page structure)
2. Keep minimalist/editorial styling — small text, muted colors, clean spacing
3. Improve over apps/web's design (better skeletons, sheets instead of page navigations, relative dates)
4. Types already exist in `packages/schemas` (re-exported via desktop `lib/data-types.ts`) — check before adding new ones
5. Navigation entry already exists in sidebar for most features — verify in `KNOWN_ROUTES`

# context-mode — MANDATORY routing rules

You have context-mode MCP tools available. These rules are NOT optional — they protect your context window from flooding. A single unrouted command can dump 56 KB into context and waste the entire session.

## BLOCKED commands — do NOT attempt these

### curl / wget — BLOCKED
Any Bash command containing `curl` or `wget` is intercepted and replaced with an error message. Do NOT retry.
Instead use:
- `ctx_fetch_and_index(url, source)` to fetch and index web pages
- `ctx_execute(language: "javascript", code: "const r = await fetch(...)")` to run HTTP calls in sandbox

### Inline HTTP — BLOCKED
Any Bash command containing `fetch('http`, `requests.get(`, `requests.post(`, `http.get(`, or `http.request(` is intercepted and replaced with an error message. Do NOT retry with Bash.
Instead use:
- `ctx_execute(language, code)` to run HTTP calls in sandbox — only stdout enters context

### WebFetch — BLOCKED
WebFetch calls are denied entirely. The URL is extracted and you are told to use `ctx_fetch_and_index` instead.
Instead use:
- `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` to query the indexed content

## REDIRECTED tools — use sandbox equivalents

### Bash (>20 lines output)
Bash is ONLY for: `git`, `mkdir`, `rm`, `mv`, `cd`, `ls`, `npm install`, `pip install`, and other short-output commands.
For everything else, use:
- `ctx_batch_execute(commands, queries)` — run multiple commands + search in ONE call
- `ctx_execute(language: "shell", code: "...")` — run in sandbox, only stdout enters context

### Read (for analysis)
If you are reading a file to **Edit** it → Read is correct (Edit needs content in context).
If you are reading to **analyze, explore, or summarize** → use `ctx_execute_file(path, language, code)` instead. Only your printed summary enters context. The raw file content stays in the sandbox.

### Grep (large results)
Grep results can flood context. Use `ctx_execute(language: "shell", code: "grep ...")` to run searches in sandbox. Only your printed summary enters context.

## Tool selection hierarchy

1. **GATHER**: `ctx_batch_execute(commands, queries)` — Primary tool. Runs all commands, auto-indexes output, returns search results. ONE call replaces 30+ individual calls.
2. **FOLLOW-UP**: `ctx_search(queries: ["q1", "q2", ...])` — Query indexed content. Pass ALL questions as array in ONE call.
3. **PROCESSING**: `ctx_execute(language, code)` | `ctx_execute_file(path, language, code)` — Sandbox execution. Only stdout enters context.
4. **WEB**: `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` — Fetch, chunk, index, query. Raw HTML never enters context.
5. **INDEX**: `ctx_index(content, source)` — Store content in FTS5 knowledge base for later search.

## Subagent routing

When spawning subagents (Agent/Task tool), the routing block is automatically injected into their prompt. Bash-type subagents are upgraded to general-purpose so they have access to MCP tools. You do NOT need to manually instruct subagents about context-mode.

## Output constraints

- Keep responses under 500 words.
- Write artifacts (code, configs, PRDs) to FILES — never return them as inline text. Return only: file path + 1-line description.
- When indexing content, use descriptive source labels so others can `ctx_search(source: "label")` later.

## ctx commands

| Command | Action |
|---------|--------|
| `ctx stats` | Call the `ctx_stats` MCP tool and display the full output verbatim |
| `ctx doctor` | Call the `ctx_doctor` MCP tool, run the returned shell command, display as checklist |
| `ctx upgrade` | Call the `ctx_upgrade` MCP tool, run the returned shell command, display as checklist |
