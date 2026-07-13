# Plan 015: Build a comprehensive, evolving personal-agent memory system

> **Executor instructions**: This is an umbrella implementation plan with
> mandatory release gates. Read the entire plan before editing. Complete phases
> in order and run every verification gate. Do not enable the next release gate
> until the previous gate's done criteria pass. If a STOP condition occurs,
> stop and report—do not improvise. When complete, update this plan's row in
> `plans/README.md` unless a reviewer says they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat a506766..HEAD -- plans/014-migrate-llm-traffic-to-vercel-ai-gateway.md apps/web/lib/llm-service.ts apps/web/lib/llm-chat.ts apps/web/lib/conversations.ts apps/web/lib/tools apps/web/models/Conversation.ts apps/web/models/Note.ts apps/web/models/NoteEmbedding.ts apps/web/models/Person.ts apps/web/models/PersonEdge.ts apps/web/models/CalendarEvent.ts apps/web/models/Email.ts apps/web/models/EmailTriage.ts apps/web/app/api/admin/chat apps/web/app/api/admin/conversations apps/web/app/api/admin/semantic packages/schemas/src packages/admin/src apps/desktop/app/dashboard apps/desktop/components/navigation apps/desktop/context/user-context.tsx turbo.json .github/workflows/ci.yml`
>
> Plan 014 is a hard dependency. If it is not DONE, stop. If its implementation
> uses different paths or service names than this plan expects, update this
> plan's path references before implementation rather than creating a second
> LLM boundary.

## Status

- **Priority**: P1
- **Effort**: XL (multi-release)
- **Risk**: HIGH
- **Depends on**: `plans/014-migrate-llm-traffic-to-vercel-ai-gateway.md`
- **Category**: direction, architecture, security, data
- **Planned at**: commit `a506766`, 2026-07-12

### Implementation checkpoint (2026-07-13)

- Work is on `feat/personal-agent-memory`; the implementation is split into
  reviewable architecture, persistence, governance, embedding, formation,
  retrieval, evaluation, console and source-adapter commits.
- Step 0 and the Gate A foundation are implemented: architecture/threat model,
  shared contracts, 16 separate persistence models and indexes, policy and
  secret filtering, revisioned governance/audit APIs, leased jobs, transactional
  conversation evidence/outbox persistence, immutable event IDs, and
  server-enforced enabled/retrieval-off/incognito modes.
- Gates A and B are released in the live settings and Gate C is enabled in
  non-injecting shadow mode. Gate D (chat injection), Gate E (reflection), and
  Gate F (proactivity) remain disabled pending their required labelled evidence.
- Gate A's recorded release verification covers a deterministic 50-event sample
  backed by an invariant scan of all 2,620 stored events across seven domains.
  The scan found zero denied matches, invalid provenance, trust mismatches, or
  oversized snapshots; two credential-bearing source records were rejected
  before persistence.
- Gate A observation now covers conversations/tool results plus bounded note,
  calendar, person, project, course, journal and email-triage mutation adapters.
  Source deletion now transactionally redacts evidence and removes derived
  candidates, memories, revisions, embeddings, traces, jobs, and downstream
  projections for conversation and the seven backfilled domains. Feedback,
  file/manual ingestion and additional canonical domains remain incomplete.
- The prior Gate C STOP is resolved: `../deniz-cloud` now runs MongoDB Community
  8.2.11 with self-managed `mongot`, and the live database accepts
  `listSearchIndexes`. The application contract is
  `agent_memory_embeddings.agent_memory_vector_v1` over `vector` (1,536d,
  cosine, scalar quantization) with `model`, `sensitivity`, `status`,
  `memoryType`, and `validUntil` filters. The live index is READY/queryable, the
  exact contract matcher passes, and a real filtered vector query succeeds.
- Gate B formation now uses a forced, schema-constrained tool result with strict
  provenance/policy checks and redacted LLM usage logging. Its six-item live
  release sample produced five safe active memories and correctly queued one
  conflict for review, with zero denied, permission-like, or trust-escalated
  outputs. Gate C hybrid
  retrieval is implemented in non-injecting shadow mode with deterministic
  scoring, hard filters, budgets, abstention, source-outage fallback, traces,
  owner-only trace APIs and a shared web/desktop inspection console.
- The seven-case `agent-memory-retrieval-v1` synthetic suite passes every
  initial numeric Gate C threshold. Five live embeddings were written and a
  real filtered vector retrieval returned five candidates without backend
  fallback while recording `injected: false`. Historical backfill processed
  2,622 records into 2,620 accepted evidence events; its remaining formation
  jobs are queued for the bounded worker. Real owner-chat
  shadow traces still need labelling before Gate D can be considered.

## Outcome

Build a persistent personal-memory layer around the single `LlmService` from
Plan 014. The system will preserve raw evidence separately from model-derived
interpretations; represent time, confidence, provenance, trust and
contradictions; maintain a comprehensive evolving model of the user; retrieve a
small task-relevant slice of that model; learn continuously from corrections
and outcomes; and give the user complete review, correction, export and
deletion controls.

The finished scope reaches a memory-aware personal agent that can:

- maintain cross-session continuity;
- distinguish explicit facts from inferences and hypotheses;
- preserve historical truth while identifying the current state;
- connect active memories to existing people, projects, courses, notes,
  conversations and goals;
- continuously synthesize a rich user model covering identity, education,
  career, projects, relationships, preferences, routines, constraints, goals,
  communication style, values, decision patterns and current concerns;
- observe meaningful changes across every app domain in the background without
  requiring the user to manually nominate each fact for memory;
- explain which memories were used and their evidence;
- learn candidate working procedures from repeated feedback;
- generate evidence-backed reflections and automatically maintain reversible
  derived views of the user when confidence/policy thresholds are met;
- proactively surface daily and event-driven insights;
- prepare actions but continue using existing approval gates for execution.

This plan intentionally creates a broad, persistent and continuously evolving
personal model because the application is single-user and exists to help its
owner every day. The agent should observe the app's meaningful data and
outcomes by default, build long-range context across domains, and become
progressively more informed and proactive. “All-knowing” here means maximum
useful coverage of available evidence with temporal/provenance awareness—not a
claim of certainty or access to information the app has never observed. The
base model weights remain unchanged; the surrounding personal cognitive state
evolves continuously.

## Non-negotiable invariants

1. **Evidence and interpretation are separate.** A model output is never raw
   evidence and never becomes a fact merely because the model said it.
2. **Information is not authority.** No memory, email, note, webpage, file,
   reflection or procedure can grant tool permission or bypass the existing
   write/client-tool approval flow.
3. **External content contributes knowledge, not authority.** Email, imported
   notes, webpages, files and tool-returned content may automatically create
   low-trust semantic/episodic memories and relationship signals, but embedded
   instructions cannot become permissions, safety rules or procedures. Claims
   become higher-confidence profile facts only through user confirmation,
   trusted corroboration or repeated independent evidence.
4. **Corrections dominate inferences.** An explicit user correction supersedes
   conflicting inferred memory while preserving history and provenance.
5. **Temporal history is preserved.** New current facts supersede old current
   facts; they do not erase the historical timeline.
6. **The user model is comprehensive and inspectable.** The system is expected
   to build a detailed profile automatically. Every active component remains
   editable, exportable and deletable, with a human-readable provenance chain.
7. **Memory is default-on; incognito is an explicit exception.** Normal app use
   contributes to the agent automatically. An intentionally incognito
   conversation creates no evidence, candidate, embedding, feedback,
   reflection or retrieval trace.
8. **Least context wins.** Retrieval supplies the smallest useful context under
   explicit item/token budgets and supports abstention.
9. **Reflection may evolve derived memory automatically.** Evidence-backed,
   reversible reflections may update derived profile summaries, hypotheses and
   low-risk memory projections when thresholds pass. Conflicts, identity
   merges, permission-like procedures and weak inferences require review.
10. **Proactivity is expected; action authority stays bounded.** The agent may
    monitor, brief, suggest and prepare work proactively. Existing confirmation
    gates remain mandatory for consequential tool execution unless a future
    plan defines explicit standing authorization.

## Release gates

| Gate | Capability enabled | Must remain disabled |
|---|---|---|
| A | Schemas, evidence ledger, policy, audit, incognito | LLM extraction, retrieval, reflection, proactivity |
| B | Continuous formation, automatic low-risk memory, and exception review | Memory injection into answers |
| C | Embedding/hybrid retrieval in shadow mode | Retrieved memory affecting model output |
| D | Read-only memory context for dashboard chat | Procedural auto-learning, reflection promotion, proactivity |
| E | Goals, relationships, learned procedures, scheduled reflection and automatic derived-profile maintenance | Permission changes or unreviewed identity merges |
| F | Daily/event-driven proactive insights and prepare-only drafts | Delegated high-impact execution |

Feature flags/policy fields must enforce these gates server-side. UI hiding is
not sufficient.

## Research basis

Use the papers as design references, not as proof that a production choice is
correct for this repository:

- [Generative Agents](https://arxiv.org/abs/2304.03442) — observation,
  retrieval, reflection and planning as separable components.
- [MemGPT](https://arxiv.org/abs/2310.08560) — hierarchical context management
  instead of loading all history into the prompt.
- [Zep temporal knowledge graph](https://arxiv.org/abs/2501.13956) — temporal
  facts/relationships and historical state preservation.
- [Mem0](https://arxiv.org/abs/2504.19413) — extraction, consolidation and
  retrieval as an explicit production lifecycle.
- [LoCoMo](https://arxiv.org/abs/2402.17753) — long-session recall, event
  summarization, temporal and causal challenges.
- [LongMemEval](https://arxiv.org/abs/2410.10813) — extraction, multi-session
  reasoning, temporal reasoning, knowledge updates and abstention.
- [Memory poisoning study](https://arxiv.org/abs/2606.04329) — aggressive
  memory writing increases exploitability; ordinary prompt-injection defenses
  do not fully address persistent poisoning.

## Current repository state

### Useful foundations

- `apps/web/models/Conversation.ts:1-80` stores complete multi-session messages,
  Anthropic content blocks, tool results and usage. It does not record memory
  mode, provenance, feedback or immutable event IDs.
- `apps/web/lib/conversations.ts:1-220` reconstructs unresolved write actions
  from tool-use/tool-result blocks and persists whole conversation arrays. The
  new memory system must not weaken this approval contract.
- `apps/web/lib/llm-chat.ts:315-739` implements pause/resume and tool-result
  ordering. Plan 014 brings it behind `LlmService`; Plan 015 adds memory context
  before the request but does not rewrite this loop.
- `apps/web/lib/tools/system-prompt.ts:1-75` already defines the personal-agent
  prompt and explicitly delegates write confirmation to the system. Memory
  context must be injected as untrusted contextual data, not concatenated as
  new authoritative instructions.
- `apps/web/models/KnowledgeSemanticSuggestion.ts:1-145` and the semantic
  accept/dismiss routes provide a local candidate-review pattern with status,
  confidence, reason and decision time. Reuse the workflow idea, not the note-
  specific collection.
- `apps/web/models/NoteEmbedding.ts:1-58` stores model, dimension, vector,
  content hash and source reference, but production retrieval is not present;
  hierarchy scripts load vectors into memory and calculate cosine similarity.
  Do not repurpose note embeddings as agent memories.
- `apps/web/models/Note.ts:1-120` has text indexes and semantic freshness fields.
  Notes can contain imported/web content and cannot automatically be trusted as
  user statements.
- `apps/web/models/Person.ts:15-45` and `PersonEdge.ts:3-55` are the canonical
  people/relationship graph. Memory links to these entities; it must not create
  a competing person database.
- `apps/web/models/CalendarEvent.ts:3-65` distinguishes manual and external
  source metadata. `Email.ts` stores headers while `EmailTriage.ts` stores
  summaries and accepted/dismissed suggestions. Prefer these bounded records
  over copying full email bodies into memory evidence.
- `packages/schemas` is the canonical Zod wire-contract package.
- `packages/admin` contains shared web/desktop feature pages; new memory
  governance UI belongs there.
- `requireAdmin` is the server authorization pattern; job routes use bearer
  tokens such as `TRIAGE_JOB_BEARER_TOKEN`.

### Gaps this plan fills

There is no immutable cross-source observation ledger, memory taxonomy,
temporal belief model, provenance graph, memory review UI, retrieval trace,
feedback lifecycle, goal/commitment model, reflection process, incognito mode,
memory export/deletion workflow, or memory-specific security policy.

## Target data architecture

Use separate collections and keep their responsibilities narrow. Exact names
may follow repository conventions, but do not collapse evidence, candidates,
active memory and embeddings into one document type.

### `AgentEvidenceEvent` — source/audit truth

Append-only except an explicit privacy deletion/redaction operation. Required
fields:

- immutable event ID and idempotency key;
- `sourceType`: conversation, tool-result, feedback, note, calendar, person,
  project, course, email-triage, journal, file, manual;
- source entity/revision references, content hash and optional bounded snapshot;
- `occurredAt`, `observedAt`, optional uncertain time range/timezone;
- actor (`user`, `agent`, `external`, `system`) and trust level;
- sensitivity class and memory eligibility;
- structured provenance metadata, extraction status stored in a separate job;
- no secrets, credentials, auth headers, passwords or raw private keys.

### `AgentMemoryCandidate` — model/manual proposal

Stores the exact proposed statement plus type, explicit/inferred/hypothesis
classification, confidence, importance, sensitivity, temporal validity,
entity links, supporting/contradicting evidence IDs, extraction model/prompt
version, reason, and status (`pending`, `accepted`, `dismissed`, `superseded`).

### `AgentMemory` and `AgentMemoryRevision` — governed interpretation

`AgentMemory` is the current projection; `AgentMemoryRevision` is append-only
history supporting rollback. Types:

- core profile;
- semantic fact/preference;
- episodic precedent;
- reflection/hypothesis.

Required semantics include active/superseded/archived/deleted status,
explicitness, confidence, importance, trust, sensitivity, `validFrom`,
`validUntil`, temporal precision, condition, evidence IDs, contradiction IDs,
entity refs, revision, creator/decider, and timestamps. Core memories have a
small prompt-time policy limit, but that limit does not constrain the full user
model. Explicit user facts can promote automatically; inferred core changes
must meet higher corroboration thresholds or enter exception review.

### `AgentUserModel` and `AgentUserModelRevision` — comprehensive personal model

This is a first-class, versioned projection synthesized from active memories,
goals, procedures, relationships and recent evidence. It is intentionally rich,
not limited to a few profile fields. Its sections include:

- identity, languages, locations and important life context;
- education, career, skills and areas of knowledge;
- active/archived projects, responsibilities and long-term ambitions;
- people, organizations, relationship roles and current relevance;
- preferences, routines, habits, constraints and recurring schedules;
- communication/work style and preferred levels of detail;
- values, priorities, trade-off patterns and recurring decision criteria;
- current goals, commitments, worries, opportunities and unresolved threads;
- stable procedures the agent should follow;
- hypotheses/reflections, separated visibly from established facts.

Every field/chunk carries evidence IDs, confidence, explicit/inferred status,
validity, last-confirmed time and revision. The projection is regenerable from
underlying state and never replaces evidence as source truth. The prompt-time
“core profile” is a compact working set dynamically selected from this full
model; it is not a cap on what the agent knows. User-pinned facts are always
eligible for that working set, while other sections are retrieved by relevance.

### `AgentProcedure`

Separate lifecycle (`candidate`, `testing`, `active`, `retired`), scope,
trigger, prescribed behavior, exceptions, supporting feedback IDs, evidence,
confidence, promotion/retirement reason and revision history. Procedures never
alter system permissions or tool approval requirements.

### `AgentGoal`

Direct goal/commitment representation: title, description, kind (`goal`,
`user-commitment`, `agent-follow-up`), status, motivation, target date/range,
constraints, dependencies, progress evidence, related entity IDs, pause/
abandon reason, provenance and revision history.

### `AgentMemoryEmbedding`

Memory revision ID, embedding model, dimensions, vector, content hash and
timestamp. Never embed secrets or disallowed sensitive content. A changed
revision receives a new embedding; deletion removes it immediately.

### `AgentFeedbackEvent`

Explicit correction/rating plus bounded behavioral signals: tool approved,
denied, failed or undone; suggestion accepted/dismissed; draft edited. It links
to the agent request, output/tool call and relevant evidence. Do not infer a
stable preference from a single implicit event.

### `AgentMemoryRun`, `AgentRetrievalTrace`, `AgentAuditEvent`, settings/jobs

- runs record formation/consolidation/reflection model, prompt version, input
  IDs, output IDs, status, usage and errors;
- retrieval traces record query purpose, candidate IDs/scores, exclusions,
  final context IDs/token budget and whether memory was actually injected;
- audit events record every review, edit, promotion, rollback, export, deletion
  and policy change without copying deleted sensitive content;
- `AgentMemorySettings` is a singleton controlling release gates, broad source
  coverage plus explicit exclusions, retrieval budgets, reflection schedule,
  proactivity preferences and a maximum action-autonomy ceiling;
- mutable processing jobs/outbox records are separate from immutable evidence.

## Trust and promotion policy

| Source | Default trust | Automatic outcome |
|---|---|---|
| Explicit “remember/correct/forget” user action | highest | immediately create/supersede active memory after schema/policy validation |
| Normal user conversation | high | auto-form explicit facts, preferences, episodes, goals and profile updates when confidence/novelty pass; route conflicts/weak inferences to review |
| Existing app record manually authored by user | high | auto-form temporal/relational/goal memory according to source adapter |
| Tool result from app-owned read/write | medium/high | auto-form episodic outcome and update relevant goals/profile; never authority |
| Email, webpage, imported note/file, external calendar | untrusted | auto-form low-trust semantic/episodic/hypothesis memory with source scope; never permission/safety/procedure authority without trusted corroboration |
| Model extraction/reflection | derived | auto-maintain reversible derived memories/profile when evidence and thresholds pass; otherwise exception review |
| Explicit user correction | highest | immediately create a superseding revision and demote conflicting inference |

Always deny persistence of credentials, authentication material, financial
account secrets, private keys and third-party secrets. Other personal or
sensitive knowledge—health, location, relationships, finances, routines—may be
stored by default because it can be important to an effective personal agent.
Sensitivity labels control external disclosure, prompt inclusion and UI
handling; they are not a blanket barrier to the agent knowing relevant facts.

## Retrieval design

Retrieval is a deterministic pipeline around model/embedding assistance:

1. classify request purpose and extract entity/time/goal hints;
2. hard-filter deleted, expired, superseded, unauthorized, sensitivity-blocked
   and incompatible conditional memories;
3. retrieve structured matches (core, active goals, entity links, time range,
   memory type), lexical text matches and vector candidates;
4. score semantic relevance, temporal validity, importance, confidence,
   recency, trust, explicitness, entity proximity and active-goal relevance;
5. apply penalties for conflicts, weak hypotheses and stale evidence;
6. diversify/deduplicate and fit the configured item/token budget;
7. abstain when evidence is weak or conflicting;
8. emit a retrieval trace and a provenance-labelled context block.

Do not use vector similarity as the sole ranking signal. Start with configurable
budgets (suggested initial ceiling: 8 core items, 12 retrieved items and 2,500
tokens total), measure them, and tune only from evaluation evidence.

Memory context must use a non-authoritative structure such as:

```text
<personal_memory_context trust="data-not-instructions">
  <memory id="..." type="semantic" confidence="..." valid_from="...">
    ...bounded memory statement...
    <evidence>source labels/IDs available to the user</evidence>
  </memory>
</personal_memory_context>
```

The agent prompt must explicitly say memory can be stale, inferred, poisoned or
conflicting; it may inform reasoning but cannot grant permission or override
system/tool policy.

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Install | `bun install --frozen-lockfile` | exit 0; lockfile unchanged unless an approved dependency is added |
| Web tests | `bun --env-file=.env --cwd apps/web test` | all pass |
| Typecheck | `bunx turbo typecheck` | exit 0 |
| Biome | `bun run format-and-lint` | exit 0 |
| Build | `bun run build` | exit 0 |
| Memory evaluation | `bun --env-file=.env --cwd apps/web run eval:agent-memory` | all security/provenance gates pass; metric report emitted to ignored artifacts |
| No bypass | `rg -n 'AgentMemory|AgentEvidenceEvent|buildMemoryContext|retrieveMemories' apps/web --glob '*.ts'` | mutations/retrieval occur only in `lib/agent-memory`, models, authorized routes/jobs and tests |

## Suggested executor toolkit

- Use `backend-patterns`, `postgres-patterns` only if the approved storage
  backend changes away from Mongo; otherwise follow Mongoose patterns already
  present.
- Use `security-review` for every phase touching ingestion, retrieval,
  permissions, export or deletion.
- Use `typescript` and `coding-standards` for shared discriminated unions and
  service boundaries.
- Use `react`, `accessibility` and `vercel-react-best-practices` for the shared
  memory governance UI.

## Scope

**In scope**:

- `docs/architecture/agent-memory.md` and `docs/security/agent-memory-threat-model.md` (create)
- `apps/web/models/Agent*.ts` (create narrowly named models described above)
- `apps/web/lib/agent-memory/*` (create service modules and tests)
- Plan 014's `apps/web/lib/llm-service.ts` and catalog/types only to add
  embedding and memory-middleware operations—never create a second LLM client
- conversation/chat persistence and route files needed for event capture,
  retrieval context, feedback and incognito
- source-domain services/routes only where a scoped observation hook is
  required; use adapters rather than scattering extraction logic
- `apps/web/app/api/admin/agent-memory/**` (create authenticated governance API)
- `apps/web/app/api/jobs/agent-memory/route.ts` (create bounded job consumer)
- `packages/schemas/src/agent-memory.ts` plus index export (create)
- `packages/admin/src/agent-memory/*` (create shared governance UI)
- web/desktop memory pages, navigation and desktop route registration
- job/env configuration in `turbo.json`, CI and environment documentation
- synthetic fixtures and evaluation harness under `apps/web/lib/agent-memory/eval/*`
- `plans/README.md` status row

**Out of scope unless a STOP condition is resolved with maintainer approval**:

- Training or fine-tuning model weights.
- A second LLM service, memory SaaS, graph database or vector vendor.
- Duplicating unlimited raw email/file/note bodies into memory collections;
  comprehensive coverage should reference canonical source records and store
  bounded evidence snapshots instead.
- Browser/Tauri code receiving raw embeddings, evidence payloads or Gateway keys.
- Cross-user tenancy; this remains the current single-admin personal system.
- Automatic identity merges in the people graph.
- Memory-derived permission changes or bypassing write confirmations.
- Delegated high-impact execution, payments, deletion of unrelated source data,
  or autonomous changes to safety/system prompts.
- Consequential tool execution without the existing approval system or a future
  explicitly configured standing-authorization plan.
- Declaring research benchmark results representative of this user's real
  long-term experience without a separate longitudinal study.

## Git workflow

- Branch: `feat/personal-agent-memory`
- Land one commit/PR per release gate where possible. Suggested sequence:
  `docs(agent): define memory model and threat model`,
  `feat(agent): add evidence ledger and governance`,
  `feat(agent): add reviewable memory formation`,
  `feat(agent): add shadow memory retrieval`, etc.
- Do not push or open a PR unless instructed.

## Steps

### Step 0: Write the architecture decision, threat model and evaluation contract

Before implementation, document:

- data flow and trust boundaries from each source to evidence, candidate,
  memory, retrieval and action;
- the exact taxonomy/schema and temporal/supersession semantics;
- sensitivity classes, denied-memory categories and retention defaults;
- poisoning threats across write, store, retrieve, apply, export and delete;
- how information remains separate from authorization;
- release flags and rollback for Gates A-F;
- evaluation datasets, baselines, metrics and thresholds;
- whether MongoDB Atlas Vector Search is available in the actual deployment.

Use MongoDB/Mongoose for source-of-truth data. If Atlas Vector Search is
available, define the index for `AgentMemoryEmbedding`. If it is unavailable,
Gate C starts with structured/text retrieval and the vector portion stops for a
maintainer decision; do not add a new database vendor implicitly. Existing
in-memory cosine scans are acceptable only for test fixtures, not unbounded
production memory.

Define baseline comparison modes: no memory, recent conversation only, full
available context where feasible, and hybrid retrieval.

**Verify**: docs contain a schema diagram, trust-flow diagram, deletion flow,
threat table, release table and explicit vector-backend decision. Reviewer can
answer every question in the research note's section 18 from these docs or see
it recorded as an open decision/STOP.

### Step 1: Implement schemas, indexes, policy and audit (Gate A)

Create Zod contracts first in `@repo/schemas`, then Mongoose models. Add
compound/unique indexes for idempotency, current revisions, pending jobs,
temporal filters, entity refs, status/type and audit time. Do not store vectors
in an unbounded field on `AgentMemory`.

Implement `agent-memory/governance.ts` as the only mutation boundary. It must:

- validate admin identity and policy at the route layer;
- create immutable audit records for every state change;
- implement revision creation instead of destructive in-place editing;
- validate provenance and disallow orphan active memories;
- enforce sensitivity and source-trust promotion rules;
- prevent memories/procedures from representing permissions;
- provide idempotent accept, dismiss, supersede, archive, rollback and delete.

During rollout, later release gates default off until their verification passes.
Once Gate A is enabled, meaningful observation is default-on for all supported
app domains and non-incognito conversations. Create migrations/index scripts
with dry-run and idempotency; never transform production data on module import.

**Verify**: model/governance tests cover invalid states, indexes, duplicate
idempotency keys, temporal ranges, revision rollback, promotion policy,
forbidden permission-like procedures and audit creation.

### Step 2: Add incognito and a durable observation/outbox pipeline

Add `memoryMode: "enabled" | "retrieval-off" | "incognito"` to conversation/
request contracts. `enabled` is the default; `retrieval-off` still learns but
does not inject memory into that conversation; `incognito` neither learns nor
retrieves. The desktop exposes these controls before the first message;
changing to incognito after evidence exists requires starting a new
conversation. The server—not the client—enforces the semantics.

After successful conversation persistence, synchronously append sufficiently
rich but bounded evidence for user turns, assistant outcomes, tool calls/results
and approval/denial outcomes, then enqueue separate formation jobs. Prefer
canonical source references plus hashes over redundant copies, but retain the
context needed to reconstruct why a memory formed. Never perform LLM extraction
as part of the persistence transaction. Job records use leases, attempt counts,
exponential backoff, dead-letter state and idempotency.

Add observation adapters incrementally during implementation, with the final
Gate A configuration enabling all supported domains by default:

- conversations/tool outcomes and explicit feedback first;
- manual notes, people, calendar, goals/projects/courses next;
- email from all app-accessible headers, triage summaries and bounded message/
  attachment excerpts, with canonical references and external trust labels;
- imported notes, files, webpages and external calendar data always untrusted.

Adapters emit canonical evidence events; they do not call the LLM or write
memory. For mutable sources, use content hashes/revision identifiers so updates
produce temporal events rather than overwriting prior evidence. App activity is
limited to meaningful domain/tool outcomes—do not log every click or keystroke.

**Verify**: integration tests prove idempotency, ordering, retry/dead-letter,
bounded sufficient payloads, trust classification and zero records of every memory-related
collection for incognito conversations.

**Gate A release**: deploy evidence/audit only. Inspect at least 50 synthetic
events and a representative sample from the owner's normal app activity.
Confirm coverage across domains, no extraction or prompt injection occurs, and
bounded evidence snapshots retain enough information before Gate B.

### Step 3: Add continuous evidence-grounded formation and exception review (Gate B)

The job consumer calls Plan 014's `LlmService.generateJson` with a strict Zod
output. Formation input contains bounded evidence marked as untrusted data,
source/trust/sensitivity metadata and relevant existing active memories for
novelty/conflict checks. The extractor may output zero candidates.

For every candidate:

- cite at least one evidence ID;
- label explicit, inferred or hypothesis;
- assign memory type, confidence, importance, sensitivity and temporal fields;
- identify supporting/conflicting memories and entity-link suggestions;
- never include permission grants or secret material;
- store model, prompt/schema version, usage and content hashes.

Rules:

- explicit user statements and high-confidence trusted app facts may become
  active automatically after policy validation;
- high-confidence, independently supported inferences may become active as
  clearly labelled inferred memories and update the comprehensive user model;
- external/untrusted evidence may auto-form low-trust semantic, episodic and
  hypothesis memory, but never permission/safety/procedure authority;
- unresolved contradictions, weak inference, identity merge, permission-like
  content and security-policy changes always enter exception review;
- one conversation choice does not become a global preference;
- a user correction creates a high-priority candidate that supersedes rather
  than deletes the historical memory;
- low novelty/duplicate candidates consolidate into evidence links, not spam.

Build authenticated APIs and `packages/admin/src/agent-memory` review UI:

- exception/candidate queue with accept/edit/dismiss/bulk safe-dismiss;
- activity feed for automatically formed memories and user-model revisions,
  with undo/correct controls;
- provenance drill-down to bounded source evidence;
- explicitness/confidence/trust/sensitivity/time badges;
- conflict/supersession timeline;
- core-memory counter/limit;
- no bulk accept for identity merges, permission-like procedures or unresolved
  conflicts.

Reuse semantic suggestion UI/status patterns, while using shared Zod contracts
and accessible keyboard/focus behavior.

**Verify**: fixtures cover explicit fact, temporary fact, changed fact,
preference, one-off choice, episode, goal, relationship ambiguity, correction,
secret, health-sensitive item and malicious email/note instructions. Malicious
instructions yield no authority/procedure memory; legitimate external facts may
remain active as low-trust, source-scoped knowledge.

**Gate B release**: run automatic formation while memory injection remains off.
Review a maintainer-labelled sample of auto-formed and exception-queued items.
Do not proceed until every active memory has valid evidence, denied secrets are
absent, and malicious instructions have acquired no authority.

### Step 4: Add embeddings and hybrid retrieval in shadow mode (Gate C)

Extend the single `LlmService` with an embedding operation routed through AI
Gateway. Discover embedding models from the catalog, configure one explicit
model/dimension, and version embeddings so a model change can reindex safely.
Exclude credentials/secrets and explicit user exclusions; other personal facts
may be embedded with sensitivity metadata because comprehensive retrieval is a
product requirement.

Implement the retrieval pipeline described above. Use structured and text
retrieval even when vector search is available. The scoring function is
deterministic/configured and returns component scores/reasons for inspection.

Run in shadow mode: for every eligible chat request, retrieve and persist a
trace but do not inject memory into the prompt. Build an admin retrieval-debug
view showing the query, filters, candidates, score components, exclusions,
selected context and provenance. The authenticated owner may inspect sensitive
evidence; disclosure to models/notifications still follows configured policy.

Handle embedding failure without blocking chat. Reindex jobs are resumable,
idempotent and rate/cost bounded.

**Verify**: deterministic tests cover temporal validity, supersession,
conflicts, confidence/trust penalties, core/goal boosts, entity proximity,
deduplication, token budget, abstention, sensitive filtering, deletion and
vector outage fallback.

Create a synthetic evaluation set covering LongMemEval-style extraction,
multi-session reasoning, temporal updates and abstention plus LoCoMo-style
cross-session/causal cases. Required initial gates:

- 100% provenance coverage for returned memories;
- 100% exclusion of deleted/incognito/unauthorized memories;
- zero malicious external fixtures promoted or treated as instructions;
- retrieval recall@10 at least 0.80 on labelled relevant-memory fixtures;
- temporal current-state accuracy at least 0.90;
- context never exceeds configured item/token budgets.

**Gate C release**: collect shadow traces and compare no-memory versus retrieved
candidate relevance. Tune from labelled traces, not anecdotes.

### Step 5: Inject read-only memory context into the personal agent (Gate D)

Enable memory only for the dashboard personal-chat purpose in `LlmService`.
Do not inject it into triage, tag classification, note grouping or unrelated
background jobs. Build the context before the agent stream begins and persist
the retrieval-trace ID with the conversation turn.

Context ordering:

1. compact task-relevant projection of the comprehensive `AgentUserModel`;
2. directly relevant active goals/commitments;
3. selected semantic/episodic memories;
4. active applicable procedures, whether explicit or learned through the
   tested promotion lifecycle;
5. conflicts/uncertainty warnings and provenance labels.

Update the system prompt with the data-not-authority rule. Add an answer-level
“memory used” disclosure in the chat UI that opens the retrieval trace and
offers Correct, Forget, Not relevant and Useful actions. The model may state
uncertainty. It should use sensitive facts when genuinely relevant, while
avoiding gratuitous disclosure of unrelated personal information; raw internal
scores remain in the governance UI.

Corrections create evidence and a superseding candidate; they do not directly
rewrite prompt text. “Forget” immediately excludes the memory from retrieval
before asynchronous cleanup.

Expose the three `memoryMode` states from Step 2 consistently. Normal chat
defaults to full learning/retrieval, retrieval-off still updates the user model,
and incognito disables both. Make this distinction explicit in UI copy.

**Verify**: agent tests compare identical prompts with memory off/on; assert
correct provenance, temporal choice, abstention, token budget, unchanged tool
approval behavior and no influence from conflicting/deleted/untrusted memory.

**Gate D release**: enable for the maintainer only. Monitor answer quality,
retrieval relevance, latency, tokens/cost and corrections. Provide one-click
server-side disable without redeploy.

### Step 6: Add goals, relationship links and correction-driven procedures

Expose goals/commitments as first-class UI/API objects with status, target,
constraints, dependencies, evidence and entity links. Agent-created follow-up
commitments require a concrete due/trigger or remain suggestions; no invisible
promises.

Resolve relationship mentions against existing `Person`/`PersonEdge` and other
domain entities. Ambiguous identity links stay candidates until confirmed.
Memory never overwrites canonical person/project/course data automatically.

Capture feedback:

- explicit useful/not-relevant/correct/forget;
- write approved/denied;
- suggestion accepted/dismissed;
- tool failed/undone where a reliable event exists;
- draft edited, storing a bounded structured diff rather than duplicate full
  sensitive content.

Generate procedures after configurable repeated signals across multiple
sessions (initial policy: at least three consistent signals across two
sessions) or an explicit user instruction. Explicit procedures can become
active immediately; inferred procedures progress candidate → testing → active
→ retired and may promote automatically after successful testing. All changes
remain inspectable/reversible. Procedures cannot alter security, permissions or
approval policy.

**Verify**: tests show a one-off event does not create a procedure, repeated
signals do, contradictory feedback lowers confidence/creates review, retirement
stops retrieval and procedure text cannot encode a permission bypass.

### Step 7: Add continuous consolidation and reflection (Gate E)

Create a bounded scheduled job using the existing authenticated job-route
pattern. It processes only changed memory IDs since the last checkpoint and
generates suggestions for:

- duplicate merge/evidence consolidation;
- newly conflicting or superseded memories;
- active/stalled/completed goals;
- candidate procedure promotion/retirement;
- higher-level reflections/hypotheses supported by multiple independent
  evidence sources;
- stale/low-value memory archival.

Every reflection cites evidence and active memories and is labelled as fact,
inference or hypothesis. Above configured evidence/confidence thresholds it may
automatically merge duplicates, supersede stale derived memories, archive
low-value items, advance goal state, promote/retire tested procedures and
revise `AgentUserModel`. Conflicts, weak hypotheses, identity merges and
permission-like changes enter exception review. Reflection never edits
canonical source entities, system prompts, permissions or approval policy. The
job has batch/token/cost/time limits, idempotency, resume checkpoints and a kill
switch; one reflection cannot serve as independent evidence for another.

Build run history and diff/review UI for automatic and queued changes. Every
automatic consolidation creates revisions and supports undo; rejected/undone
changes become negative feedback to avoid immediate repetition.

**Verify**: repeated runs are idempotent; conflicting, weakly supported and
malicious-source reflections remain pending or are rejected by policy; rollback
restores the prior projection and embeddings.

**Gate E release**: run manually first, then scheduled automatic consolidation
with exception review. Require a labelled review sample before enabling each
automatic change class, then keep the schedule default-on with a kill switch.

### Step 8: Implement privacy controls, export, deletion and recovery

Add settings/UI for source coverage, explicit exclusions/pauses, release gates,
retention, reflection schedule, notification preferences, maximum action-
autonomy ceiling and proactivity. Once a gate is verified, supported sources
and continuous learning default on; controls are for exclusions and tuning, not
for assembling the personal model manually.

Implement:

- export of settings, evidence metadata/snapshots, candidates, memories,
  revisions, comprehensive user-model revisions, procedures, goals, feedback
  and audit/retrieval references in a documented JSON bundle;
- delete one memory, all memories from evidence/source, a date range/category,
  or the complete agent memory;
- immediate retrieval exclusion plus deletion of embeddings/cache;
- privacy deletion that removes/redacts content while retaining only an opaque
  non-content audit tombstone where legally/operationally necessary;
- rollback before deletion and explicit confirmation for destructive actions;
- backup/restore test for schemas and indexes.

Do not silently delete canonical conversations, notes, people or email when a
memory is deleted. Offer separate, clearly scoped source deletion only where an
existing endpoint already supports it.

**Verify**: export round-trip schema validation, deletion cascade tests, no
deleted content in retrieval/export/logs, incognito audit, and restore in a
disposable database.

### Step 9: Add default-on proactive everyday assistance (Gate F)

Create a default-on proactive insight engine with an in-app inbox and daily
briefing. Candidate triggers may include an
approaching goal/deadline, calendar conflict, unresolved agent follow-up,
accepted memory contradiction or repeated failure. Compute:

- expected usefulness;
- urgency;
- confidence;
- interruption cost;
- user category preference;
- whether a silent draft is sufficient.

The system may observe, brief, suggest or prepare a draft without waiting for a
prompt. Delivery timing/category/channel can adapt from repeated feedback within
the explicit maximum proactivity/autonomy settings; optional existing
notification channels may be enabled by the owner. Execution still goes
through existing tool/write approval. Each insight shows trigger evidence,
reasoning, proposed action, expiry and Dismiss/Snooze/Useful controls.
Dismissals update the user model and procedure/preferences using the same
evidence thresholds as other learning.

Memory/reflection may tune topics, timing, interruption cost and channel below
the user-configured ceiling, but cannot raise that ceiling or grant action
authority. Rate-limit per category/day and suppress duplicates.

**Verify**: deterministic trigger tests, rate/duplicate suppression, expired
insights, low-confidence abstention, prepare-versus-interrupt policy and proof
that no tool executes without the existing approval path.

**Gate F release**: enable the in-app inbox/daily briefing by default for the
owner. Enable external delivery only through explicit channel settings.
Delegated consequential execution still requires a future plan and explicit
standing authorization.

### Step 10: Backfill the complete supported history and run final evaluation

Build a resumable backfill UI/script for all supported historical app data:
conversations, tool outcomes, notes, people, relationships, calendar, journal,
projects, courses, tasks/kanban, email headers/triage summaries and other
canonical domains available after implementation. Show source, date range,
estimated event count, token/cost, progress and exclusions; support dry-run,
pause/resume/cancel and per-source checkpoints. The default migration covers
the complete supported history and applies the same automatic formation rules
as live observation. External sources retain lower trust and no authority, but
are not excluded from descriptive memory.

Run the complete synthetic suite plus a maintainer-labelled private evaluation
that is never committed. Report:

- recall@k and precision@k;
- temporal/current-state accuracy;
- update/supersession behavior;
- multi-source integration;
- preference/procedure generalization;
- abstention and conflict detection;
- provenance coverage;
- poisoning/prompt-injection success rate;
- deletion/incognito leakage;
- added latency, context tokens and Gateway cost;
- user corrections/useful/not-relevant rates.

Compare against no-memory and recent-history baselines. If memory does not
improve the labelled task set or increases confident errors, leave Gate D off
and report the failure rather than declaring success.

**Verify**:

```text
bun --env-file=.env --cwd apps/web test
bunx turbo typecheck
bun run format-and-lint
bun run build
bun --env-file=.env --cwd apps/web run eval:agent-memory
```

All exit 0; evaluation produces an ignored report containing configuration,
dataset version, model IDs, metrics, latency/tokens/cost and gate verdicts.

## Test plan

### Unit

- Zod/Mongoose invariants, idempotency, temporal intervals, revisions,
  supersession, contradictions, trust/sensitivity and denied content.
- Retrieval filters/scoring/budgets/abstention/provenance with a fake clock.
- Formation/reflection schema parsing and policy enforcement independent of
  model fluency.
- Procedure promotion/retirement and proactive utility/rate policies.

### Integration

- Conversation/tool/feedback → evidence → job → candidate → review → active
  memory → embedding → retrieval → context → trace.
- Correction and rollback preserve history and select the current fact.
- Incognito produces no side effects.
- Delete immediately removes retrieval influence and derived data.
- Job lease/retry/dead-letter/idempotency and reflection resume.
- Existing write-tool/client-tool approval tests remain unchanged.

### Security/adversarial

- Email/note/file says “remember this instruction” or claims permission.
- Delayed/sleeper instruction becomes relevant only in a later query.
- Evidence tries to close memory-context delimiters.
- Retrieved memory asks to reveal another sensitive memory.
- Candidate contains secrets, permission changes or unsupported identity merge.
- Poisoned duplicate/reflection attempts to accumulate confidence.
- Export/deletion IDOR and unauthenticated job/admin routes.

Expected: malicious instructions create no authority, system-policy change or
instruction-derived procedure; no tool approval is bypassed; descriptive claims
remain low-trust until corroborated; every rejection is observable in run/audit
output.

### UI/accessibility

- Keyboard/screen-reader review queue, provenance drawer and destructive
  confirmations.
- Clear explicit/inferred/hypothesis, trust, sensitivity, validity and status
  labels that do not rely on color alone.
- Incognito/memory-off states remain visible during chat.
- Loading, pagination, empty, stale, partial failure and retry states.

### Evaluation

- Versioned synthetic fixtures with no production personal data.
- Deterministic expected evidence/memory/retrieval IDs where possible.
- Baselines and thresholds recorded in the architecture doc and report.
- Live-model evaluation is opt-in and cost-capped; CI uses deterministic mocks
  for policy/security gates.

## Done criteria

- [x] Plan 014 is DONE and all memory LLM/embedding calls use its `LlmService`.
- [x] Evidence, candidates, active projections, revisions and embeddings are
      separate and linked by provenance.
- [ ] `AgentUserModel` is a comprehensive, versioned and automatically updated
      projection spanning identity, life context, work, relationships,
      preferences, routines, goals, style, values and current concerns.
- [ ] Meaningful observation and formation default on across every supported
      app domain; incognito/exclusions are explicit overrides.
- [ ] Every active memory has evidence, explicitness, confidence, sensitivity,
      temporal validity and audit history.
- [ ] Trusted explicit facts and threshold-passing descriptive/inferred memory
      form automatically; exception review handles conflicts, weak inference,
      identity merges and permission-like changes.
- [ ] Explicit corrections supersede inferred memories without erasing history.
- [ ] Incognito creates zero memory-related records or traces.
- [ ] Retrieval uses structured, lexical and configured vector signals—not vector
      similarity alone—and respects item/token budgets.
- [ ] Memory is default-on for personal-chat requests except retrieval-off/
      incognito overrides and is labelled data, never authority.
- [x] Existing tool approval/client execution behavior is unchanged.
- [ ] Goals and procedures have explicit lifecycle/status/provenance.
- [ ] Reflection automatically maintains reversible derived memories and the
      comprehensive user model while never changing authority/system policy.
- [ ] Export, rollback and deletion pass round-trip/cascade tests.
- [ ] Proactive inbox/daily briefings run by default and adapt timing/topics
      below the configured ceiling; no unapproved consequential execution
      exists.
- [ ] Resumable backfill covers all supported historical domains by default,
      with progress, pause/cancel and exclusions.
- [x] Memory governance APIs/jobs require admin/job authorization and shared
      Zod contracts.
- [ ] Poisoning fixtures produce zero authority bypasses or instruction-derived
      procedures; descriptive external claims remain source-weighted and cannot
      self-amplify into certainty.
- [ ] Provenance and deletion/incognito evaluation gates are 100%.
- [ ] Recall@10 ≥ 0.80 and temporal current-state accuracy ≥ 0.90 on the
      versioned synthetic suite, or Gate D remains disabled with a BLOCKED
      report.
- [ ] Full tests, typecheck, Biome, build and memory evaluation exit 0.
- [ ] `plans/README.md` status is updated with enabled release gates and any
      deferred gate explicitly recorded.

## STOP conditions

Stop and report rather than improvising if:

- Plan 014 is not complete or a caller would create a second LLM/embedding
  boundary.
- The evidence/memory schema cannot represent source provenance, uncertainty,
  valid time, contradiction, supersession, sensitivity and revisions without
  lossy overloading.
- A source lacks enough provenance/trust metadata even to store as low-trust
  evidence. Quarantine those records and report; do not silently omit an entire
  useful domain when bounded provenance can be attached.
- Atlas Vector Search is unavailable and production vector retrieval would
  require a new vendor or unbounded in-memory scan.
- A current tool/action path can bypass approval, or memory would need to grant
  permissions to be useful.
- Incognito cannot be proven to prevent all memory-derived side effects.
- Credentials/secrets or explicit exclusions would be sent for embedding/
  extraction, or sensitive-data handling/disclosure rules are undefined.
- External/untrusted instructions can become authority/procedure memory, bypass
  approval, or manufacture confidence through repeated poisoned duplicates.
- Deletion cannot remove content from embeddings, caches, retrieval and export,
  or audit requirements conflict with complete content deletion.
- The evaluation suite fails provenance, poisoning, incognito or deletion
  gates. These are hard safety failures, not tunable quality metrics.
- Retrieval does not improve the labelled baseline or materially increases
  confident errors; leave memory injection disabled.
- Reflection/proactivity begins changing canonical source records, system
  prompts, permissions or executing consequential tools without required
  approval. Automatic derived profile/memory revision is expected and is not a
  STOP when provenance, thresholds and rollback are intact.
- The task expands into fine-tuning, a second data platform, multi-user tenancy,
  new external-notification integrations beyond already configured app channels,
  or delegated consequential execution without a new approved plan.
- A verification fails twice after a reasonable correction.

## Maintenance notes

- Treat prompt/schema/model/embedding changes as data migrations: version them,
  re-evaluate, and reindex explicitly.
- Increase or reduce automatic learning/proactivity using labelled precision,
  longitudinal usefulness and security evidence—not merely queue size.
- Source data and memory serve different purposes. Link to canonical people,
  notes, projects, courses and calendar items instead of duplicating them.
- Apply encryption, access control, retention, cost and disclosure policy while
  expanding comprehensive coverage of sensitive personal sources. Existing
  note embeddings are an implementation clue, not sufficient validation for
  the broader memory index.
- Keep retrieval traces long enough to debug corrections, but apply retention
  and redaction because traces reveal what influenced answers.
- Use user corrections and explicit feedback as the strongest learning signal;
  do not let repeated model reflections manufacture certainty.
- Future delegated autonomy must build on `AgentGoal`, insights, procedures and
  the existing approval system through a separate plan and threat review.
- Longitudinal success requires periodic real-user review: usefulness should
  rise while corrections, irrelevant retrieval and confident errors fall.
