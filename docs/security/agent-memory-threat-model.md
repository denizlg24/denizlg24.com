# Agent memory threat model

## Security objectives

1. Stored information cannot become system or tool authority.
2. Every active interpretation is traceable to evidence and revision history.
3. Incognito activity has no memory-derived side effects.
4. Secrets and explicit exclusions never reach storage, models or embeddings.
5. Deletion removes influence and content from retrieval, export and derived
   state while retaining only non-content audit tombstones.
6. Only the authenticated owner and authenticated bounded jobs can read or
   mutate memory state.

## Assets and boundaries

Protected assets include evidence snapshots, sensitive memories, the user
model, feedback, retrieval queries/traces, Gateway credentials, job tokens and
write approvals. Trust boundaries exist at every source adapter, the admin API,
the job route, model input/output, storage, retrieval context, export and the
existing tool execution layer.

The model is not a trusted principal. Email, imported notes, webpages, files,
external calendar events and tool-returned text are untrusted even when the
application fetched them successfully.

## Threat table

| Stage | Threat | Required control | Verification |
|---|---|---|---|
| Write | Prompt injection asks the system to remember an instruction | Delimit/escape snapshots; classify external actor/trust; deny authority/procedure candidates | Malicious email/note/file fixtures |
| Write | Credential or private key is captured | Pre-storage denied-content classifier plus bounded redaction; fail closed | Secret format fixtures and log assertions |
| Write | Replayed adapter event amplifies confidence | Unique idempotency key; source/revision hash; corroboration counts independent sources | Duplicate and poisoned-repetition tests |
| Write | Mutable source overwrites history | Append temporal event with source revision/hash | Changed-fact integration test |
| Store | Candidate becomes fact because a model emitted it | Separate candidate collection; deterministic policy; evidence requirement | Orphan/invalid promotion tests |
| Store | Derived reflections self-corroborate | Derived records cannot count as independent evidence for another reflection | Reflection-chain fixture |
| Store | Permission-like procedure is activated | Denied authority vocabulary and structured scope; exception review; no permission field | Procedure policy tests |
| Store | Identity entities are silently merged | Identity links remain candidates and canonical people graph is never mutated | Ambiguous-relationship fixture |
| Retrieve | Deleted, expired or superseded belief is selected | Hard filters before scoring and immediate exclusion tombstone | Temporal/deletion tests |
| Retrieve | Vector similarity alone promotes poison | Structured/lexical/vector union, trust/conflict penalties and abstention | Sleeper and conflict fixtures |
| Retrieve | Sensitive but irrelevant fact is disclosed | Purpose/sensitivity filter, least-context budgets, disclosure policy | Cross-topic sensitive fixture |
| Apply | Memory closes delimiters or injects tool instructions | XML escaping, provenance labels and system data-not-authority clause | Delimiter fixture and prompt snapshot |
| Apply | Memory bypasses a write/client approval | Existing registry and approval state remain the sole authority | Existing chat approval characterization tests |
| Apply | Agent follows a stale procedure | Validity/lifecycle filters, contradiction warnings and rollback | Retired procedure test |
| Export | Unauthenticated/IDOR export leaks the user model | `requireAdmin`, singleton-owner scope, schema validation and audit | Route authorization tests |
| Export | Deleted content remains in bundle | Immediate exclusion plus cascade/redaction before export | Post-delete export test |
| Delete | Cache/embedding continues to influence answers | Tombstone first, then embedding/cache deletion, then derived rebuild | Retrieval before/after delete |
| Delete | Audit retains sensitive plaintext | Opaque IDs/action/time only after redaction | Audit content scan |
| Jobs | Forged or unbounded job consumes data/cost | Dedicated bearer token, operation allowlist, lease, batch/time/token/cost limits | Auth and limit tests |
| UI | Bulk action approves a conflict or identity merge | No bulk accept for unsafe candidate classes; explicit confirmation | Keyboard and action-policy tests |

## Information versus authority

The only sources of execution authority remain code-defined tool registration,
server authentication, the write-tool classification and explicit approval or
client execution messages already used by the dashboard chat. Memory records
have no permission, authorization, approval or safety-policy fields.

Candidate text matching permission-like requests is rejected or quarantined.
Procedure scope can describe when a behavior is useful, but cannot declare a
tool safe, auto-approved, privileged or exempt. Retrieval context is placed in
an explicitly untrusted data block and is never concatenated into the system
instruction section.

## Sensitivity and denied content

`standard`, `personal`, `sensitive` and `restricted` data may be stored when
eligible. The label controls UI handling, model disclosure and notification
channels. `denied` data is never persisted beyond an in-memory rejection
decision.

Denied categories include passwords, session cookies, bearer/API tokens,
OAuth refresh tokens, private keys, recovery codes, full payment credentials,
database connection strings and authentication headers. Detection combines
structured field-name rejection, well-known token/key patterns and conservative
entropy/format checks. False positives are rejected rather than persisted.

## Incognito proof obligation

The server resolves `memoryMode` from the persisted conversation before any
memory boundary. For incognito conversations it skips evidence append, outbox,
formation, feedback persistence, embedding, retrieval trace, reflection input
and proactive triggers. A client-supplied mode cannot downgrade a persisted
conversation after evidence exists. Tests count every `Agent*` collection
before and after full user/assistant/tool/approval flows and require a zero
delta.

Operational request logs must not copy message bodies. General conversation
persistence remains canonical app behavior and is outside agent memory, but an
incognito conversation can still be deleted through the existing conversation
API.

## Deletion and recovery

Deletion begins with a synchronous exclusion tombstone so a partially failed
cascade cannot retrieve the target. The worker then deletes embeddings and
cached context, redacts or removes content-bearing evidence/candidates/
revisions/feedback/traces, and regenerates the user model. It never silently
deletes canonical source entities. Retry is idempotent and its audit record
contains no deleted text.

Backups and restores must preserve indexes, revision order and tombstones. A
restore into a disposable database is accepted only when deleted content stays
excluded and current projections point to valid revisions.

## Release review checklist

- Gate A: authorization, schemas/indexes, governance/audit, denied-content and
  incognito tests pass; deployed evidence sample contains no secrets.
- Gate B: every active memory cites evidence; malicious instructions yield no
  authority; automatic promotion precision is maintainer-labelled.
- Gate C: bounded production vector backend exists; provenance, leakage,
  poisoning and budget hard gates pass.
- Gate D: memory improves the labelled baseline; approval behavior is byte-for-
  byte equivalent in characterization tests; server kill switch works.
- Gate E: automatic derived changes are revisioned and reversible; identity,
  permissions and canonical source records stay untouched.
- Gate F: rate limits and interruption policy work; every prepared action still
  enters the existing approval path.

Any hard-gate failure disables the affected and later gates. Two failed
verification attempts after a reasonable correction stop the release.
