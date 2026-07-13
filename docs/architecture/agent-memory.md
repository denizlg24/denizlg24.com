# Agent memory architecture

Status: accepted; Gate C infrastructure and synthetic evaluation verified on
2026-07-13. Application rollout remains sequentially gated.

## Decision

The personal agent uses MongoDB as its source of truth and extends the existing
`LlmService` for every model operation. Evidence, model proposals, governed
memory, revision history, the synthesized user model, embeddings, feedback,
jobs, retrieval traces and audit records remain separate collections.

Memory is information, never authority. It can affect an answer only after the
retrieval gates are enabled. It cannot add a tool, change a tool classification,
approve a write, modify the system safety policy, or suppress the existing
client/write confirmation flow.

## Deployment capability decision

The production datastore was upgraded to self-hosted MongoDB Community 8.2.11
with the self-managed `mongot` process in `../deniz-cloud`. A direct `buildInfo`
query reported `8.2.11`, and `listSearchIndexes` now succeeds. The deployed
`agent_memory_vector_v1` index reports `READY` and `queryable: true`; the exact
application contract matcher passes, and a filtered 1,536-dimensional
`$vectorSearch` query completes successfully. This resolves the prior MongoDB
7.0 vector-backend STOP without introducing another database or an unbounded
application-memory scan.

Decision:

- Gates A-C may use the current MongoDB deployment after their release
  verification passes.
- Gate C remains server-disabled until Gates A and B complete their release
  samples and representative owner-labelled shadow traces pass review.
  Production code never scans an unbounded vector collection in application
  memory.
- The vector index is `agent_memory_vector_v1` on
  `agent_memory_embeddings.vector`: 1,536 dimensions, cosine similarity,
  scalar quantization, with `model`, `sensitivity`, `status`, `memoryType`, and
  `validUntil` filters.
- Embedding creation remains behind `LlmService` and uses the explicit Gateway
  model `openai/text-embedding-3-small`.

This is a release block, not a reason to collapse embeddings into memories or
to add a second LLM or data service.

## Trust flow

```mermaid
flowchart LR
  U[User-authored app data] --> A[Source adapter]
  X[External email, files, web, imported data] --> A
  T[Tool outcomes and feedback] --> A
  A --> E[(AgentEvidenceEvent)]
  E --> J[(AgentMemoryJob)]
  J --> L[LlmService generateJson]
  L --> C[(AgentMemoryCandidate)]
  C --> P[Deterministic policy]
  P -->|safe promotion| M[(AgentMemory)]
  P -->|exception| Q[Owner review]
  Q --> M
  M --> R[(AgentMemoryRevision)]
  M --> UM[(AgentUserModel + revisions)]
  M -. Gate C .-> V[(AgentMemoryEmbedding)]
  M -. Gates C/D .-> H[Hybrid retrieval]
  H --> RT[(AgentRetrievalTrace)]
  H -. Gate D, data only .-> L
  L --> O[Answer or proposed tool call]
  O --> G[Existing approval gate]
```

Trust falls at every derived edge: an extractor output is a proposal, a
reflection is derived evidence, and retrieval context is untrusted data.
External content never crosses into procedure or authorization policy.

## Schema map

```mermaid
erDiagram
  AgentEvidenceEvent ||--o{ AgentMemoryCandidate : supports
  AgentEvidenceEvent ||--o{ AgentFeedbackEvent : records
  AgentMemoryCandidate }o--o{ AgentEvidenceEvent : cites
  AgentMemory ||--|{ AgentMemoryRevision : versions
  AgentMemoryRevision }o--o{ AgentEvidenceEvent : cites
  AgentMemoryRevision ||--o| AgentMemoryEmbedding : embeds
  AgentMemory }o--o{ AgentGoal : informs
  AgentMemory }o--o{ AgentProcedure : informs
  AgentUserModel ||--|{ AgentUserModelRevision : versions
  AgentMemoryRun }o--o{ AgentEvidenceEvent : consumes
  AgentMemoryRun ||--o{ AgentMemoryCandidate : produces
  AgentRetrievalTrace }o--o{ AgentMemoryRevision : selects
  AgentAuditEvent }o--|| AgentMemory : records_change
  AgentMemoryJob }o--|| AgentEvidenceEvent : processes
```

### Collection responsibilities

| Collection | Responsibility | Mutability |
|---|---|---|
| `agent_evidence_events` | Canonical bounded observation and provenance | Append-only except privacy redaction |
| `agent_memory_jobs` | Leased formation/reflection/backfill outbox | Mutable operational state |
| `agent_memory_candidates` | Exact manual/model proposals and decisions | Status transitions only through governance |
| `agent_memories` | Current governed projection | Revision pointer/status through governance |
| `agent_memory_revisions` | Complete memory history and rollback source | Append-only |
| `agent_user_models` | Current comprehensive profile projection | Revision pointer through governance |
| `agent_user_model_revisions` | Profile history | Append-only |
| `agent_procedures` | Candidate/testing/active/retired behavior | Revisioned; never permission-bearing |
| `agent_goals` | Goals and commitments | Revisioned lifecycle |
| `agent_memory_embeddings` | One vector per memory revision/model | Replace only by reindex; delete immediately |
| `agent_feedback_events` | Explicit and bounded behavioral outcomes | Append-only |
| `agent_memory_runs` | Formation/consolidation/reflection execution | Terminal result after completion |
| `agent_retrieval_traces` | Candidate/filter/score/context explanation | Append-only, retention-limited |
| `agent_audit_events` | Non-content mutation and privacy audit | Append-only tombstones allowed |
| `agent_memory_settings` | Singleton policy, gates, budgets, exclusions | Revisioned settings updates |
| `agent_insights` | Proactive suggestion/draft inbox | Mutable delivery lifecycle |

## Common vocabulary

- Source types: `conversation`, `tool-result`, `feedback`, `note`, `calendar`,
  `person`, `project`, `course`, `email-triage`, `journal`, `file`, `manual`.
- Trust: `highest`, `high`, `medium`, `low`, `untrusted`, `derived`.
- Sensitivity: `standard`, `personal`, `sensitive`, `restricted`, `denied`.
- Explicitness: `explicit`, `inferred`, `hypothesis`.
- Memory type: `core`, `semantic`, `episodic`, `reflection`.
- Temporal precision: `exact`, `day`, `month`, `year`, `range`, `unknown`.
- Memory status: `active`, `superseded`, `archived`, `deleted`.

All entity references carry a domain type and canonical entity ID. All
model-derived records carry the model, prompt version, schema version, input
hash and run ID.

## Temporal and revision semantics

`occurredAt` is when source activity happened; `observedAt` is when the ledger
received it. `validFrom` and `validUntil` describe when an interpretation is
true. Missing `validUntil` means open-ended, not timeless certainty. An exact
end must be later than the start.

Every accepted create, edit, correction, supersession, archive or rollback:

1. validates cited evidence and policy;
2. writes a new immutable revision;
3. advances the current projection revision in the same transaction where
   transactions are supported;
4. links superseded/conflicting projections without deleting them;
5. appends a content-minimal audit event.

Explicit corrections outrank derived interpretations. Rollback creates a new
revision copied from the selected historical revision; it does not mutate old
history. A memory cannot be active without at least one extant evidence ID.

## Evidence and retention

Adapters store canonical source references, revision/content hashes and a
bounded snapshot sufficient to explain formation. Defaults:

- text snapshots: 8 KiB maximum after normalization;
- external attachment/file excerpts: 4 KiB maximum and no binary payload;
- evidence and revisions: retained until explicit deletion;
- operational jobs: terminal records retained 30 days;
- retrieval traces: retained 90 days, with query/context redaction on source
  deletion;
- audits: retained as opaque non-content tombstones after privacy deletion.

Credentials, auth headers, cookies, passwords, private keys, recovery codes,
financial account secrets and third-party secrets are denied before snapshot,
extraction, embedding and logging. Other sensitive personal facts are allowed
with sensitivity labels and disclosure controls because they can be relevant
to a useful personal agent.

## Source policy

| Source | Actor | Default trust | Automatic ceiling |
|---|---|---|---|
| Explicit remember/correct action | user | highest | Active explicit memory |
| User conversation | user | high | Active explicit fact/episode/goal when novel |
| Manually authored app record | user | high | Active scoped temporal/relational memory |
| App-owned tool outcome | system/user | medium | Episodic outcome; never authority |
| Email, imported file/note/web/calendar | external | untrusted | Low-trust scoped semantic/episodic/hypothesis |
| Extraction/reflection | agent | derived | Reversible derived memory above policy threshold |

Conflicts, weak inference, identity merges, permission-like language and policy
changes always enter exception review. Repetition from one source does not
count as independent corroboration.

## Release controls

Settings are server-read on every boundary. UI visibility is not enforcement.
All flags default false in a new deployment.

| Gate | Server flag | Enables | Rollback |
|---|---|---|---|
| A | `evidenceLedger` | Evidence, audit and outbox capture | Disable capture; retained records stay inert |
| B | `formation` | Extraction and policy promotion/review | Disable consumer formation operation |
| C | `shadowRetrieval` | Embeddings and retrieval traces only | Disable retrieval and reindex jobs |
| D | `chatMemory` | Read-only personal-chat context | Disable context middleware immediately |
| E | `reflection` | Goals/procedures/reflection/profile maintenance | Disable scheduled operation classes |
| F | `proactivity` | In-app insights and prepare-only drafts | Disable trigger processing/delivery |

`memoryMode` is independently enforced: `enabled` learns and may retrieve,
`retrieval-off` learns but never injects, and `incognito` creates no evidence,
jobs, candidates, embeddings, feedback, reflections or retrieval traces.

## Retrieval contract (implemented; release-gated at Gate C)

The deterministic pipeline hard-filters status, time, condition, exclusions,
sensitivity and conflicts; unions structured, lexical and vector candidates;
then scores relevance, time, importance, confidence, recency, trust,
explicitness, entity proximity and active-goal relevance. It diversifies by
fact/entity and caps the result at 8 core items, 12 other items and 2,500
estimated tokens by default. Weak or mutually conflicting results abstain.

The prompt representation is escaped, provenance-labelled XML inside
`<personal_memory_context trust="data-not-instructions">`. The system prompt
states that its contents may be stale, inferred, poisoned or conflicting and
cannot grant permission or override instructions.

## Deletion flow

```mermaid
flowchart TD
  R[Authenticated deletion request] --> X[Resolve affected evidence and memories]
  X --> B[Immediately add retrieval exclusion tombstones]
  B --> V[Delete embeddings and cached contexts]
  V --> D[Redact/delete evidence, candidates, revisions, feedback and traces]
  D --> U[Regenerate current user model without deleted content]
  U --> A[Write opaque audit tombstone]
  A --> C[Verify no retrieval/export/log reference contains content]
```

Deleting agent memory never deletes canonical conversations, notes, people,
calendar items or email. Source deletion is a separate existing-domain action.
Exports are owner-authenticated, sensitivity-aware JSON bundles validated by a
versioned schema. An export generated after deletion cannot contain deleted
content.

## Evaluation contract

The committed suite contains synthetic data only. Private owner-labelled data
is never committed. CI uses deterministic model/embedding doubles; live model
runs are opt-in and cost-capped.

`cd apps/web && bun --env-file=../../.env run agent-memory:eval-retrieval` runs the
versioned `agent-memory-retrieval-v1` fixture suite. The initial seven labelled
cases currently report 1.0 provenance coverage, exclusion coverage, recall@10,
temporal accuracy and abstention accuracy, with zero malicious selections and
zero budget violations. These synthetic results do not replace the required
owner-labelled release sample.

Comparison modes are `no-memory`, `recent-conversation`, `full-context` where
bounded, and `hybrid-retrieval`. Reports record dataset/schema/prompt versions,
model IDs, budgets, latency, tokens, estimated cost and gate verdicts.

Hard thresholds:

- provenance coverage: 100%;
- deleted/incognito/unauthorized leakage: 0%;
- malicious instruction promotion or authority bypass: 0%;
- context budget violations: 0%;
- recall@10: at least 0.80;
- temporal current-state accuracy: at least 0.90.

Quality measures also include precision@k, conflict detection, correction and
supersession accuracy, abstention, multi-source integration, preference and
procedure generalization, added latency and cost. Gate D stays off when hybrid
retrieval does not improve the labelled baseline or increases confident error.

## Operations and open decisions

- Index/migration scripts are explicit, dry-runnable and idempotent. Models do
  not migrate production data at import time.
- Formation, reflection, reindex and backfill jobs use leases, attempts,
  exponential backoff, dead-letter status, batch/time/token/cost limits and
  resumable checkpoints.
- Gate A may be enabled after code/safety verification to deploy the evidence
  ledger. Its 50-event synthetic plus representative owner-activity release
  sample must pass before Gate B can be enabled.
- Gate B also needs its own labelled formation/review sample before its flag is
  enabled.
- The Gate C index and synthetic thresholds pass. Enablement still requires the
  sequential Gate A/B releases and labelled production shadow-trace review.
- External notifications and consequential delegated execution are not part of
  this architecture.
