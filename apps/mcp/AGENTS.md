# apps/mcp — infrastructure MCP server

Every admin action of the infrastructure is a tool: `src/tools/forge/`
(`/api/deploy` + `/api/forge`), `src/tools/cloud/` (`/api/ops`, `/api/projects`,
`/api/db/*`, `/api/auth/admin`), `src/tools/storage/` (`/api/storage`,
`/api/search`), `src/tools/web/` (`/api/admin/*` on denizlg24.com) and
`src/tools/status/` (`/api/admin/*` on status.denizlg24.com). The
catalogue with every tool → route mapping is
`docs/internal/plans/020-mcp-full-tool-catalogue.md`.

- **Two shapes, one helper each** (`src/tools/define.ts`). Infra is
  per-operation (`defineTool`, one precise schema, e.g. `forge_target_update`);
  web is per-resource with an `action` enum (`defineActions`, e.g. `web_blogs`
  with `list|get|create|update|toggle|delete`). Id-only transitions on infra
  also use `defineActions` (`forge_deployment_action`). Names are enforced at
  registration: `<forge|cloud|storage|web|status>_<resource>_<verb>`.
- **`defineActions` merges every action's fields into one advertised schema**,
  each field labelled with the actions that use it, and parses the call with
  the chosen action's own schema. So the same concept must carry the same
  field name across a tool's actions (`id`, not `id` in one and `noteId` in
  another), and `action` is a reserved field.
- **The SDK must never validate arguments against a tool's schema.**
  `advertisedOnly` hands it the JSON Schema plus a pass-through validate. If
  the merged schema validated, a `.default()` or transform on one action's
  field would be applied to every action sharing the name before its own
  parse — `web_agent_tasks.update` sent create's `attachments: []` and
  `memoryMode`, which wipes stored values. `define.test.ts` pins this.
- **Upstream failures are `isError` results, never thrown.** `fromResponse`
  maps non-2xx to `{ status, error: <body> }`; success carries the body plus
  `httpStatus` in `structuredContent`. A tool that throws is a bug.
- **Input schemas come from `@repo/schemas`** wherever a route validates with
  one — spread `.shape` for objects, nest unions under a named field. Zod v4
  keeps `.shape` on refined objects, and the refinement is dropped by the
  spread: upstream re-validates, so that is fine.
- **List tools return summaries; get tools return whole rows.** A list of
  full rows overflows a tool result: `forge_targets_list` was 117 KB for 18
  targets, 65 KB of it commit bodies. `forge/summaries.ts` builds each summary
  schema from the canonical `@repo/schemas` shapes, so parsing strips the rest;
  a payload that stops matching falls back to cutting commit messages and logs
  a warning instead of failing the call.
- **Logs are bounded reads of live streams.** Build and runtime logs are SSE
  that never ends while a build runs or a container lives; `collectStream`
  reads for `maxMs` (default 4 s) or 512 KB and reports `complete`.
- **`forge_env_set` / `forge_env_unset` are GET → merge → PUT.** Safe only
  because a literal sent without `value` keeps the stored one; `GET .../env`
  never returns literal values. Nothing takes effect until `forge_env_apply`.
- **`cloud_run_command` parks a one-off a year out, triggers it, and polls.**
  The far date only keeps the one-off poller from racing the explicit
  trigger; the scheduler disables any non-cron task after its first run. The
  task row is kept for audit.
- **Unreachable by design, not oversight**: OAuth client management
  (`/api/oauth/*` refuses `oauth:` sessions, and this server *is* one), SMB
  credentials (human session only), the interactive terminal (WebSocket), the
  web LLM proxies (`chat`, `POST llm`, latex completion), `jobs/*`
  (`CRON_SECRET`), `authenticator/export`, and binary-only reads.
- **Tests build the client through the real HTTP handler**
  (`src/tools/harness.test-util.ts`): `recordingUpstream` records every call,
  `createClient(upstream, register?)` takes a registrar so a domain's test
  registers only its own tools; a third argument adds request headers.
  `tools/list` in the registry test is what proves every schema converts to
  JSON Schema.
- **Every web call carries the in-app agent's `x-agent-actor` when the MCP
  request did.** `request-context.ts` holds it in AsyncLocalStorage for the
  request and `createApi` adds it to web calls only; web attributes workspace
  changes with it. Other upstreams never see it.
- **`readOnly: true` on an action is an approval decision, not a label.**
  `defineActions` publishes each action's flags as
  `_meta["com.denizlg24/actions"]`, and the in-app agent runs a call without
  asking only when the chosen action is read-only. A read action left unmarked
  asks for approval every time; a write marked read-only never does. The
  tool-level `readOnlyHint` stays false for any tool that mixes the two.
- **`src/instructions.ts` is sent at initialize** and is the one place the
  domain workflows (read-before-replace, notes `categorize`, papers
  `resolve`, markets budget, …) are written down for every client.
  `instructions.test.ts` fails when it names a tool that does not exist.
- **Two surfaces over one registry.** Every tool carries
  `_meta["com.denizlg24/surface"]`: `compact` (whoami, the catalog tools and
  `DIRECT_TOOLS` in `src/tools/surface.ts`) or `catalog`. The default
  `compact` profile lists the 19 compact ones (≈5k tokens) to every client,
  Claude Code included; `x-mcp-tool-profile: full` or `?profile=full` lists
  all ~270 (≈116k tokens of schemas).
  `bun run scripts/tool-surface.ts` prints both; `catalog.test.ts` bounds the
  compact one. Nothing was renamed — names in instructions, `disabledTools`
  and client permissions stay valid.
- **The catalog routes to the very handlers the named tools run.**
  `defineTool` / `defineActions` record every tool in a per-server registry;
  `catalog_search` and `catalog_describe` read it, and `catalog_read` /
  `catalog_write` / `catalog_destructive` take `{resource, operation, args}`
  where `resource` is the tool name and `operation` the action (omitted for a
  single-operation tool, which answers to `run`). `args` is parsed by the
  operation's own schema; an `INVALID_INPUT` comes back with that schema.
- **Each call tool accepts only its own kind** (`operationKind`: read-only,
  else destructive, else write — the same rule web's approval applies) and
  answers `WRONG_TOOL` otherwise, which is what keeps the call tools'
  annotations honest for clients that only read annotations. Granting a
  client `catalog_write` therefore grants every write — which is why tools
  that run code, mint or reveal credentials, or send mail are in
  `DIRECT_TOOLS`: off the catalog (`DIRECT_TOOL` error), listed by name in
  both surfaces. Adding a tool of that kind means adding it there.
- **The compact profile only unlists.** `applyToolProfile` removes the
  catalog-surface registrations after `registerCatalog` has bound their
  handlers, so a call by an unlisted name fails while the catalog still
  reaches it. Web's primary connector always sends
  `x-mcp-tool-profile: full` (`connectorTransport` in
  `lib/connectors/service.ts`): it caches the whole listing for triage and the
  connector settings, and filters to the compact surface per turn itself.
  A client permission granted on a catalog tool's own name
  (`mcp__denizlg24__web_notes`) no longer matches anything under compact; it
  is `catalog_read` / `catalog_write` / `catalog_destructive` now.
