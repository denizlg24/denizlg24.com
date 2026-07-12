# Plan 014: Centralize all LLM traffic behind one Gateway-backed service

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update this plan's row in
> `plans/README.md` unless a reviewer says they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat a506766..HEAD -- apps/web/lib/llm.ts apps/web/lib/llm-chat.ts apps/web/lib/triage.ts apps/web/lib/note-categorize.ts apps/web/lib/semantic-llm.ts apps/web/lib/tag-classify.ts apps/web/scripts/generate-hierarchy-draft.ts apps/web/app/api/admin/chat/route.ts apps/web/app/api/admin/llm/route.ts apps/web/app/api/admin/notes/[noteId]/enhance/route.ts apps/web/models/TriageSettings.ts apps/desktop/components/ui/model-selector.tsx apps/desktop/app/dashboard/_components/chat-view.tsx apps/desktop/hooks/use-chat-stream.ts packages/schemas/src/llm.ts turbo.json .github/workflows/ci.yml`
>
> If an in-scope file changed since this plan was written, compare the
> "Current state" excerpts against live code. A material mismatch is a STOP
> condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: none
- **Category**: migration, tech-debt
- **Planned at**: commit `a506766`, 2026-07-12

## Decision and feasibility verdict

This is feasible. The target is not merely a shared API key or base URL: it is
one server-side `LlmService` that owns model discovery, model validation,
capability checks, transports, retries, streaming, structured generation,
usage attribution, and the existing agent loop. Every application call site
must depend on that service instead of importing an Anthropic client or
constructing a Chat Completions request itself.

Use Vercel AI Gateway's `GET https://ai-gateway.vercel.sh/v1/models` as the
runtime model catalog. It returns the complete Gateway catalog—not only models
created or hosted by Anthropic—and requires no authentication. Expose all
`type: "language"` entries to model-selection UIs, with creator, pricing,
context/output limits, and capability tags. When a surface specifically wants
Anthropic-created models, filter by canonical ID prefix `anthropic/` (and treat
`owned_by` as display metadata, not the routing provider).

Dynamic discovery does not mean every model is safe for every operation. The
service must define request profiles and validate catalog tags before sending:

- plain text: language model
- tool agent and forced-tool triage: `tool-use`
- web-search chat: `web-search`
- reasoning UI/options: `reasoning`
- explicit prompt caching: `explicit-caching` when the request requires it

Do not maintain a hardcoded selectable-model list. Retain only a small,
explicit legacy-alias map so existing clients and Mongo settings such as
`claude-haiku-4-5-20251001` continue to resolve. Defaults for unattended jobs
must remain configurable because triage and semantic work cannot wait for a
human selection; use fully qualified model IDs in environment/database
settings and validate them against the catalog.

The future memory-aware, app-governing agent is intentionally out of scope.
However, centralizing request metadata now (`purpose`, `source`, actor or
conversation identifier when already available) creates the seam where memory
and governance can later be attached once, without revisiting every caller.
Do not add memories, retrieval, autonomous scheduling, or a global agent prompt
in this plan.

## Target architecture

```text
API routes, triage, note/category jobs, scripts
                       |
                       v
             one server-side LlmService
              /         |          \
       model catalog  request      agent/tool loop
       + capability   profiles     + usage logging
         policies       |                |
              \         |          transport adapters
               \        |        /                 \
                Gateway /v1/models   Anthropic Messages  Chat Completions
                                      via Gateway         via Gateway
```

`LlmService` is an in-process server module, not a new HTTP microservice and
not a route that server code calls over the network. Existing public/admin API
routes remain thin adapters. The model-list API exists only so web/desktop UIs
can consume the same catalog owned by the service.

The service should expose a narrow operation-oriented interface, for example:

```ts
interface LlmService {
  listModels(filter?: ModelFilter): Promise<LlmModel[]>;
  resolveModel(request: ModelRequest): Promise<LlmModel>;
  countTokens(request: CountTokensRequest): Promise<number>;
  generateText(request: GenerateTextRequest): Promise<TextResult>;
  generateJson<T>(request: GenerateJsonRequest<T>): Promise<JsonResult<T>>;
  generateToolResult<T>(request: ToolResultRequest<T>): Promise<ToolResult<T>>;
  streamText(request: StreamTextRequest): Promise<ReadableStream>;
  streamAgent(request: AgentStreamRequest): ReadableStream;
}
```

Names may change to match local conventions, but callers must not receive a
raw SDK client or construct provider URLs. Provider-specific details remain
inside adapters owned by the service.

## Authoritative references

- [Vercel model discovery](https://vercel.com/docs/ai-gateway/models-and-providers#dynamic-model-discovery) — unauthenticated REST discovery, model metadata, pricing, and type filtering.
- [Live AI Gateway model catalog](https://ai-gateway.vercel.sh/v1/models) — current catalog; validate the response contract immediately before implementation.
- [Vercel model endpoint details](https://vercel.com/docs/ai-gateway/models-and-providers#using-rest-api) — per-model endpoint discovery for supported parameters, provider pricing, uptime, throughput, and latency.
- [Vercel Anthropic Messages API](https://vercel.com/docs/ai-gateway/sdks-and-apis/anthropic-messages-api) — Anthropic SDK, token counting, streaming, tools, prompt caching, thinking, and web search through Gateway.
- [Vercel provider options](https://vercel.com/docs/ai-gateway/models-and-providers/provider-options) — provider ordering, restrictions, caching, routing, and BYOK.
- [Vercel model fallbacks](https://vercel.com/docs/ai-gateway/models-and-providers/model-fallbacks) — model fallback extensions across Gateway API formats.
- [Vercel observability](https://vercel.com/docs/ai-gateway/observability-and-spend/observability) — project-scoped request, token, latency, provider, and spend views.
- [Vercel pricing](https://vercel.com/docs/ai-gateway/pricing) and [BYOK](https://vercel.com/docs/ai-gateway/authentication-and-byok/byok) — Gateway credits, budgets, provider rates, and credential behavior.

## Current state

### LLM inventory

The migration is incomplete unless all of these surfaces use `LlmService`:

| Surface | Current transport/model source | Behavior to preserve |
|---|---|---|
| Dashboard assistant | Anthropic Messages stream; desktop hardcoded selector | SSE deltas, parallel tools, read execution, write approval, client tools, pause/resume, caching, thinking, web search, abort, persistence |
| Generic `/api/admin/llm` and note enhance | Anthropic token count + Messages stream | Preflight token count, text stream, abort, usage |
| Email triage prefilter | Anthropic forced tool; Mongo model setting | `return_spam_ids`, no parallel tool use |
| Email triage classification | Anthropic forced tool; Mongo model setting | `classify_email`, downstream coercion |
| Email triage extraction | Anthropic forced tool; Mongo model setting | `extract_triage_details`, validated task/event suggestions |
| Note categorization | Anthropic JSON text; hardcoded dated Haiku | Graceful parse fallback |
| Hierarchy draft script | Anthropic JSON text; hardcoded dated Haiku | Script output and usage attribution |
| Semantic knowledge classifier | Direct DeepSeek-compatible fetch | JSON object, token usage, hard failure on absent result |
| Blog/project topic classifier | Direct DeepSeek-compatible fetch | JSON object, token usage, graceful fallback |

### Evidence

`apps/web/lib/llm.ts:5-11` directly instantiates Anthropic from a provider key:

```ts
if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is not defined");
}

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});
```

The same file owns hand-maintained pricing and limits, token counting, basic
streaming, SSE conversion, and local usage logging. These responsibilities
belong behind the central service; the live catalog can replace most selectable
model, pricing, context, and output-limit hardcoding.

`apps/web/lib/llm-chat.ts:545-555` directly starts Anthropic streams, while
lines 670-739 implement the important all-tool-results-in-one-user-turn,
write-approval, and client-tool invariants. Preserve those invariants, but make
the loop an internal component of `LlmService.streamAgent` with an injected
Gateway Messages adapter rather than a global SDK import.

`apps/web/lib/triage.ts:567-596`, `1028-1040`, and `1171-1183` make three
forced-tool calls. Their outputs drive classification and task/calendar
suggestions. Migrate them to `generateToolResult<T>` without changing prompts,
schemas, coercion, or writes.

`apps/web/lib/semantic-llm.ts:19-20,83-103,146-185` and
`apps/web/lib/tag-classify.ts:35-56,83-132` independently configure DeepSeek
and POST to `/chat/completions`. Both must use `LlmService.generateJson<T>`.

`apps/web/models/TriageSettings.ts:79-80` stores legacy Anthropic-native
defaults. Existing records may retain those strings after schema changes, so a
tested legacy-alias map remains necessary even though the selector becomes
dynamic.

`apps/desktop/components/ui/model-selector.tsx:26-38` hardcodes six Claude
models and `chat-view.tsx:352` hardcodes a Haiku default. Replace this list with
the authenticated model-catalog API. The current Radix select is not suitable
for hundreds of models; use the repository's searchable combobox/command
components and group by creator.

`packages/schemas/src/llm.ts` already owns shared LLM usage wire schemas. Add
the model catalog response contract there so web and desktop do not invent
separate interfaces.

`turbo.json:10,37-39` passes direct Anthropic/semantic variables, and CI has an
Anthropic placeholder. Both need a unified Gateway environment contract.

### Conventions to preserve

- Bun workspaces/Turborepo; never npm or pnpm.
- Strict TypeScript, Biome, and canonical Zod wire contracts in
  `packages/schemas`.
- `bun:test`; `apps/web/lib/triage.test.ts` demonstrates environment setup
  before dynamic import.
- Server and client tools remain defined by `apps/web/lib/tools/registry.ts`.
- The desktop consumes authenticated web APIs through `denizApi` rather than
  calling third-party model endpoints directly.
- For cached server fetches, match the existing `next: { revalidate: ... }`
  pattern in `apps/web/lib/calendar-sync.ts:36-39` after reading the installed
  Next.js 16 docs required by `apps/web/AGENTS.md`.

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Install | `bun install --frozen-lockfile` | exit 0; lockfile unchanged unless an approved dependency is added |
| Web tests | `bun --env-file=.env --cwd apps/web test` | all pass |
| Typecheck | `bunx turbo typecheck` | exit 0 |
| Biome | `bun run format-and-lint` | exit 0 |
| Build | `bun run build` | exit 0 |
| No direct-provider config | `rg -n 'ANTHROPIC_API_KEY|SEMANTIC_LLM_(API_KEY|BASE_URL)|api\.deepseek\.com' apps turbo.json .github` | no production matches |
| One LLM boundary | `rg -n 'new Anthropic|messages\.(create|stream|countTokens)|/chat/completions' apps/web --glob '*.ts'` | matches only inside central service transport/agent internals and live contract tests |
| No hardcoded desktop catalog | `rg -n 'claude-(opus|sonnet|haiku)' apps/desktop --glob '*.ts' --glob '*.tsx'` | no model-list/default matches |

## Scope

**In scope**:

- `apps/web/lib/llm-service.ts` (create: sole application-facing facade)
- `apps/web/lib/llm-model-catalog.ts` (create: fetch, validate, cache, filter)
- `apps/web/lib/llm-transports/*` (create only if separation improves clarity)
- `apps/web/lib/llm.ts` (reduce to internals/re-exports or retire safely)
- `apps/web/lib/llm-chat.ts` (preserve loop; make internal/injected)
- `apps/web/lib/triage.ts`
- `apps/web/lib/note-categorize.ts`
- `apps/web/lib/semantic-llm.ts`
- `apps/web/lib/tag-classify.ts`
- `apps/web/scripts/generate-hierarchy-draft.ts`
- `apps/web/app/api/admin/chat/route.ts`
- `apps/web/app/api/admin/llm/route.ts`
- `apps/web/app/api/admin/llm/models/route.ts` (create)
- `apps/web/app/api/admin/notes/[noteId]/enhance/route.ts`
- `apps/web/models/TriageSettings.ts`
- `packages/schemas/src/llm.ts`
- `apps/desktop/components/ui/model-selector.tsx`
- `apps/desktop/app/dashboard/_components/chat-view.tsx`
- `apps/desktop/hooks/use-chat-stream.ts` only if model errors need typed handling
- `turbo.json`, `.github/workflows/ci.yml`, environment documentation
- focused tests beside new/affected modules
- `plans/README.md` status row

**Out of scope**:

- Memory storage/retrieval, embeddings, RAG, long-term user profiles, an app
  governor prompt, autonomous actions, or background agent scheduling.
- A new HTTP microservice or server-to-self HTTP calls.
- Changing SSE event names, conversation storage, approval semantics, tool
  behavior, triage prompts, or downstream writes.
- Exposing image/video/embedding/reranking models in this text-model selector.
- Assuming all discovered models support tools or structured generation.
- Cross-model fallbacks during initial cutover.
- Removing the local `LlmUsage` dashboard.
- Requiring a wholesale Vercel AI SDK rewrite. It may be evaluated separately;
  the centralized facade must keep that future transport swap internal.

## Git workflow

- Branch: `refactor/central-llm-service`
- Conventional commits, for example:
  `refactor(llm): add centralized gateway service`,
  `feat(llm): discover gateway models dynamically`,
  `refactor(llm): migrate all callers to service`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Characterize current behavior before moving it

Add focused tests around the existing seams before changing transports:

- basic text stream and abort
- agent text-only response
- one and two parallel read tools
- write-tool pause/approve/deny
- client-tool pause/resume
- mixed read/write/client turn ordering
- triage forced-tool parsing for all three phases
- semantic hard failure versus tag-classifier graceful fallback

Mock network/SDK calls. Assert SSE event names and persisted Anthropic content
block ordering, not implementation details.

**Verify**: focused tests pass on pre-migration code and fail if the relevant
behavior is intentionally broken in the test mock.

### Step 2: Define the central service and request profiles

Create `LlmService` as the sole application-facing LLM dependency. Define
provider-neutral request/result types for text, JSON, forced-tool results,
token counting, streaming, and agent streaming. Each request carries:

- `purpose`: stable enum such as `chat`, `triage-prefilter`,
  `triage-classify`, `triage-extract`, `note-categorize`, `semantic`,
  `topic-classify`, or `hierarchy-draft`
- `source`: existing usage attribution
- `model`: fully qualified Gateway ID or a legacy alias at compatibility edges
- optional existing conversation/actor identifier; do not invent identity data
- explicit requirements: tools, web search, reasoning, JSON, caching

Create request profiles that translate operations into required catalog
capabilities and defaults. Defaults must be fully qualified IDs supplied via
validated environment/database settings, not a UI model array. Keep a minimal
legacy alias map only for existing desktop/Mongo values.

The service owns usage logging and cost estimation. Use live catalog pricing
when available. Label local cost as estimated, handle tiered/cache pricing, and
never silently use a generic default price for an unknown model.

**Verify**: `llm-service.test.ts` covers request metadata, every profile,
legacy aliases, unsupported-capability errors, missing defaults, usage
attribution, and unknown pricing.

### Step 3: Implement cached dynamic model discovery

Fetch `GET https://ai-gateway.vercel.sh/v1/models` inside
`llm-model-catalog.ts`. Validate the upstream body before use. Model the fields
the app needs: `id`, `name`, `description`, `owned_by`, `type`, `tags`,
`context_window`, `max_tokens`, and pricing including optional tiers/cache
prices. Preserve unknown tags/fields safely.

Cache successful responses for 15 minutes using the installed Next.js 16
server-fetch convention. Also retain the last successful in-process value for
stale-on-error behavior during a warm instance. Never cache a malformed or
non-2xx response as success. Deduplicate concurrent refreshes through one
in-flight promise so a cold burst does not fan out to Vercel. Bound the upstream
request with a 5-second timeout and at most one jittered retry; after that use
the last valid stale value or the typed cold-start failure below.

Catalog behavior:

- `listModels()` returns all language models, sorted by creator then name.
- `listModels({ creator: "anthropic" })` filters IDs starting `anthropic/`.
- `listModels({ requiredTags: [...] })` requires all tags.
- `resolveModel()` validates syntax, catalog membership, type, and profile
  capabilities.
- A catalog outage must not terminate an already-running stream.
- On a cold start with no valid/stale catalog, model listing returns a typed
  503. Generation may use only a fully qualified configured default or a model
  already selected from a previously validated catalog; do not silently pick a
  random replacement.
- Discovery never reads or requires `AI_GATEWAY_API_KEY`; validate that key
  lazily only when a generation/counting operation begins.

Do not call the endpoint on every LLM request. Do not treat `owned_by` as the
actual serving provider; Gateway may route one creator's model through several
providers.

**Verify**: catalog tests cover valid data, type/creator/tag filters, sorting,
15-minute caching, concurrent refresh deduplication, timeout/retry,
stale-on-error, cold failure, operation without a Gateway key, malformed
bodies, tiered pricing, model removal, and capability rejection.

### Step 4: Publish one authenticated model-catalog API

Add Zod contracts to `packages/schemas/src/llm.ts`, including a compact model
shape and `{ models, stale, fetchedAt }` response. Do not send fields the UI
does not use.

Create `GET /api/admin/llm/models` using `requireAdmin`. It calls only
`llmService.listModels`, accepts allowlisted query filters (`creator`,
`requiredCapability`), returns language models only, uses `503` for an
unavailable cold catalog, and never proxies an arbitrary URL.

Add route tests for authentication, response validation, filtering, stale
metadata, upstream failure, and rejection of unknown filters.

**Verify**: route tests pass and the response parses with the shared schema.

### Step 5: Replace hardcoded desktop selection with discovery

Have the desktop fetch the authenticated models endpoint through `denizApi`.
Replace the six-item/legacy switch selector with a searchable combobox grouped
by creator. Show model name, creator, context size, and relevant capability
badges without rendering raw pricing noise in every row.

The chat selector requests all language models. Its visible eligible set must
react to enabled features:

- tools enabled → require `tool-use`
- web search enabled → require `web-search`
- both enabled → require both

Do not silently switch the selected model when toggles make it incompatible.
Show a clear incompatibility state and disable send until the user selects a
compatible model or changes the toggles. If discovery is unavailable, retain
the selected fully qualified model for display, show a retry state, and do not
fall back to a hardcoded list.

Persist the selected fully qualified ID in existing user settings if a suitable
field exists; otherwise keep current component-lifetime behavior and explicitly
defer persistence. Remove hardcoded label maps by resolving labels from the
catalog, with the raw ID as a safe fallback for old conversations.

**Verify**: component tests cover loading, search/grouping, large catalogs,
capability filtering, incompatible selection, stale catalog, retry, and raw-ID
fallback.

### Step 6: Route Anthropic-based paths through `LlmService`

Configure the internal Anthropic Messages adapter with
`AI_GATEWAY_API_KEY` and `https://ai-gateway.vercel.sh`. Keep the current SDK
for the first migration because it preserves Messages event/content-block
contracts.

Migrate token counting, basic streaming, the full agent loop, all three triage
forced tools, note categorization, and the hierarchy script. API routes and
jobs call service operations only. `llm-chat.ts` may remain as an internal
agent-loop module, but it receives its transport and usage hooks from the
service and exports no raw client.

Preserve caching, adaptive thinking, web search, retries, abort, tool ordering,
approvals, client tools, and SSE shapes. Capability validation happens before
opening a stream. Do not change prompts or tool schemas.

**Verify**: characterization tests from step 1 pass unchanged; repository
search finds no Anthropic client import outside central transport internals and
tests.

### Step 7: Route DeepSeek paths through `LlmService`

Implement the Gateway Chat Completions adapter behind
`generateJson<T>`. Migrate semantic knowledge and tag/project classification.
Preserve `temperature`, `response_format: { type: "json_object" }`, parsing,
usage, and each caller's failure policy.

Remove `SEMANTIC_LLM_API_KEY` and `SEMANTIC_LLM_BASE_URL`. Replace the provider
alias `deepseek-chat` with a fully qualified configurable model such as
`deepseek/deepseek-v3.2`, but require live JSON contract tests before accepting
that default. The catalog supplies candidate models; a human-owned setting
selects the unattended-job default.

**Verify**: no direct `/chat/completions` construction remains outside the
central adapter; service and characterization tests pass.

### Step 8: Update environment, CI, and live contracts

Update `turbo.json`, CI, and environment documentation for
`AI_GATEWAY_API_KEY` plus fully qualified default model settings required by
unattended profiles. Remove direct-provider variables after code references are
gone. Never expose the Gateway key to browser code. Do not validate it at module
import: discovery and non-generation tests must work without it, while every
generation/counting method fails with a typed configuration error before
opening an upstream request when it is absent.

Configure Gateway budgets and model/provider allowlists. If using BYOK, keep
Gateway credits as required by Vercel. Retain direct provider credentials only
for a 48-hour rollback window, then rotate/revoke them if unused elsewhere.

Add opt-in live tests, skipped without a scoped key:

1. model discovery and schema validation
2. token counting
3. plain streaming
4. streamed forced tool call
5. two parallel tool calls on a `tool-use` model
6. web search on a `web-search` model
7. JSON Chat Completions for the configured semantic model
8. a negative capability-validation case that makes no upstream generation call

Log only purpose, model ID, and pass/fail—never credentials or personal prompt
content.

**Verify**: unit tests pass with placeholder config; live tests pass with a
real scoped key and explicitly skip without it.

### Step 9: Stage and cut over

Run all repository gates, deploy to staging, and test:

| Case | Expected |
|---|---|
| Catalog | searchable Gateway language models; creator/capability metadata |
| Plain chat | any selected language model streams text |
| Tool chat | only `tool-use` models selectable; reads and parallel results work |
| Write/client/mixed tools | existing pause/resume/approval ordering unchanged |
| Web search | only compatible models selectable; blocks persist/rehydrate |
| Abort | upstream stops; no corrupt continuation |
| Triage | all forced-tool results remain schema-valid |
| Semantic/topic | configured model returns normalized JSON |
| Catalog outage | stale or typed unavailable state; no hardcoded list appears |

Confirm all nine inventory surfaces appear in Gateway observability with their
purpose/source attribution reflected locally. Compare local estimated spend to
Gateway billed spend and investigate missing/zero or order-of-magnitude drift.

After production cutover, monitor stream errors, tool completion, triage null
rates, semantic fallbacks, cache reads, token/spend trends, and catalog errors.
Rollback is the previous deployment plus retained provider variables, not an
undocumented dual-routing path.

**Verify**:

```text
bun --env-file=.env --cwd apps/web test
bunx turbo typecheck
bun run format-and-lint
bun run build
```

All exit 0 and the staging matrix is recorded in the PR/deployment note.

## Test plan

- `llm-model-catalog.test.ts`: response validation, all filters, capability
  rules, cache/stale/cold behavior, catalog churn, prices/limits.
- `llm-service.test.ts`: every operation and purpose profile, configurable
  defaults, legacy aliases, unsupported models, usage/error normalization.
- `llm-chat.test.ts`: text, read/parallel tools, approvals, client tools, mixed
  turns, abort, persistence, unchanged SSE events.
- `triage.test.ts`: retain injection tests and add mocked forced-tool contracts
  without downstream writes.
- Semantic/topic tests: JSON success, missing content/usage, malformed/non-2xx,
  and distinct failure policies.
- Models route tests: auth, schema, filters, stale and 503 behavior.
- Desktop selector tests: large dynamic list, search/grouping, toggled
  capabilities, stale/retry/incompatible/raw-ID states.
- Opt-in live tests from step 8; never expose a real key to untrusted PR CI.

## Done criteria

- [ ] All nine inventory surfaces call one `LlmService` facade.
- [ ] No application caller imports a provider SDK client or builds a provider
      URL/request.
- [ ] `GET /v1/models` is the source of selectable models, capabilities,
      limits, and current pricing metadata.
- [ ] Catalog discovery works without `AI_GATEWAY_API_KEY`; generation validates
      the key lazily and server-side.
- [ ] The authenticated app endpoint exposes all Gateway language models and
      supports creator/capability filters.
- [ ] Desktop model selection contains no hardcoded model catalog or label map.
- [ ] Tool/web-search selection and server requests reject incompatible models
      before generation.
- [ ] Only the legacy alias map and configurable unattended-job defaults remain
      static; neither is presented as the available catalog.
- [ ] Existing SSE, tool approval/client execution, persistence, triage prompts,
      and downstream writes are unchanged.
- [ ] All direct provider keys/base URLs are removed from production code and
      `AI_GATEWAY_API_KEY` remains server-only.
- [ ] Local usage retains source/purpose attribution; unknown-model cost is not
      silently calculated from a generic default.
- [ ] Memory, retrieval, and autonomous governance were not implemented.
- [ ] Full tests, typecheck, Biome, and build exit 0.
- [ ] Live contracts and staging matrix pass; production traffic appears only
      in Gateway after cutover.
- [ ] `plans/README.md` status row is updated.

## STOP conditions

Stop and report instead of improvising if:

- The live `/v1/models` response no longer supplies stable IDs, model type,
  capability tags, limits, or usable pricing metadata as documented.
- Gateway catalog tags are insufficient to determine a required capability.
  Investigate the per-model endpoints API and report the required extra data;
  do not guess compatibility from model names.
- The proposed central service leaks raw provider clients/types back to callers
  or turns into a server-to-self HTTP microservice.
- Gateway Messages does not preserve token counting, streamed tool JSON,
  multiple tools, forced tools, caching, thinking, or web-search contracts.
- The selected semantic model does not reliably honor JSON-object responses.
- Existing Mongo triage settings contain unknown aliases that cannot be mapped
  safely.
- Supporting a discovered model requires changing the public SSE protocol,
  persisted conversation format, tool semantics, prompts, or downstream writes.
- Dynamic discovery causes every request to depend on a fresh catalog network
  call or a catalog outage blocks an already-running stream.
- The work starts implementing memory, embeddings, retrieval, autonomous
  actions, or the app-governor agent beyond preserving request metadata.
- A scoped Gateway key, staging environment, or budget/allowlist configuration
  is unavailable before live verification.
- A verification fails twice after a reasonable correction.

## Maintenance notes

- The Gateway catalog changes over time. Never reintroduce a hand-maintained UI
  model list; update capability/profile policy only when an operation changes.
- "Creator" and "serving provider" are different. `anthropic/...` identifies
  the model creator; Gateway may serve it through Anthropic, Bedrock, Vertex,
  or another endpoint according to routing policy.
- Defaults for unattended jobs are policy, not catalog. Keep them explicit,
  fully qualified, validated, and observable.
- Use Gateway billed spend as authoritative. Keep local per-purpose cost as an
  estimate unless the response supplies exact billed metadata.
- The centralized service is the future extension point for memory and app
  governance. Add those later as service middleware/context assembly rather
  than reconnecting individual call sites.
- A future Vercel AI SDK migration should replace only central transport
  internals. The service interface, callers, model catalog, and behavior tests
  should remain stable.
