# Semantic Notes Migration — Progress

Tracks implementation of `semantic-notes-and-bookmarks-migration-plan.md`.
Embedding runtime decision: **Python sidecar** (managed by Tauri).

---

## Phase 1: API Schema Additions (`portfolio-2026`)

### Done

- **`models/Note.ts`** — added `semanticStatus`, `semanticContentHash`, `semanticUpdatedAt`, `semanticError` (schema + interfaces + indexes). Exported `NoteSemanticStatus` type.
- **`models/NoteGroup.ts`** — added `kind`, `source`, `lockedByUser`, `semanticRunId`, `semanticClusterKey`, `confidence`, `aliases`. Exported `NoteGroupKind`, `NoteGroupSource` types.
- **`models/NoteEdge.ts`** — added `source`, `model`, `runId`, `metadata.{similarity,sharedGroupIds,explanation}`. Exported `NoteEdgeSource`, `INoteEdgeMetadata`.
- **`models/NoteEmbedding.ts`** — new. Collection `knowledge_note_embeddings`. Unique `{noteId, model}`, indexes on `contentHash`, `updatedAt`.
- **`models/KnowledgeSemanticRun.ts`** — new. Collection `knowledge_semantic_runs`. Embedded `parameters` subschema with defaults (`topK=8`, `minSimilarity=0.72`, `strongSimilarity=0.82`, `clusterMinSize=3`, `maxGroupsPerNote=3`).
- **`models/KnowledgeSemanticSuggestion.ts`** — new. Collection `knowledge_semantic_suggestions`. Indexes on `{status,type}`, `{noteId,status}`, `{groupId,status}`.
- **`lib/note-route-utils.ts`** — `serializeGroup` and `serializeEdge` now stringify `semanticRunId`/`runId`.
- **`lib/semantic-serializers.ts`** — new. `serializeEmbedding`, `serializeSemanticRun`, `serializeSemanticSuggestion`.
- **`scripts/migrate-semantic-defaults.ts`** — new. Backfills defaults on existing notes/groups/edges. Supports `--dry-run`. Run with the existing tsx/node runner used by `scripts/migrate-knowledge.ts`.
- **`app/api/admin/notes/route.ts`**
  - `GET` extended with `semanticPending`, `semanticStale`, `suggestionsPending` stats + optional `semantic.latestRun` block.
  - `POST` now sets `semanticStatus: "pending"` on created notes. Existing `skipCategorize` body flag still respected (plan's `useLegacyLlmCategorization` inversion is intentionally deferred — see TODO below).

### TODO — remaining Phase 1 work

- **`app/api/admin/notes/[noteId]/route.ts`**
  - On PATCH/PUT of semantic-affecting fields (`title, content, url, description, siteName, tags, groupIds, class`), set `semanticStatus = "stale"`. Skip when patch body carries a fresh `semanticContentHash` + `semanticStatus: "embedded"` (semantic sync path).
  - On DELETE: also delete matching `NoteEmbedding` docs and `KnowledgeSemanticSuggestion` docs where `noteId` matches.
- **Group delete route** — dismiss/supersede pending suggestions targeting the group; mark member notes stale.
- **POST behavior flip** — change default from `skipCategorize` opt-in to `useLegacyLlmCategorization` opt-in (Phase 5 in plan; keep as-is for now until semantic engine is wired).
- **New semantic API endpoints** (none implemented yet):
  - `GET /api/admin/semantic/notes`
  - `POST /api/admin/semantic/runs`
  - `POST /api/admin/semantic/runs/:id/complete`
  - `POST /api/admin/semantic/embeddings/bulk` (validate `dimension===384`, batch ≤ 100)
  - `POST /api/admin/semantic/edges/bulk` (normalize `from < to`, only replace `source="semantic"` when `replaceSemanticEdges`)
  - `POST /api/admin/semantic/suggestions/bulk` (supersede prior pending same note/group/type)
  - `GET /api/admin/semantic/suggestions`
  - `POST /api/admin/semantic/suggestions/:id/accept` (per-type mutation matrix in plan)
  - `POST /api/admin/semantic/suggestions/:id/dismiss`
  - `POST /api/admin/semantic/label-clusters` (LLM, Phase 4)
- **Feature flag** `SEMANTIC_NOTES_ENABLED` not added yet.

---

## Phase 2: Desktop Semantic Engine (`denizlg24-app`)

Not started.

Planned scaffolding when picked up:
- `lib/data-types.ts` — extend `INote`, `INoteGroup`, `INoteEdge`; add `INoteEmbedding`, `ISemanticSuggestion`.
- `lib/semantic/{content-hash,embedding-text,cosine,nearest-neighbors,clustering,suggestions,semantic-sync}.ts`.
- Python sidecar (Tauri-managed) exposing `embed_texts({model, inputs}) -> {model, dimension:384, embeddings: number[][]}` for `intfloat/multilingual-e5-small`.
  - Bundle sentence-transformers; binary built via PyInstaller or similar; declared in `src-tauri/tauri.conf.json` `bundle.externalBin`.
  - Tauri command `invoke("embed_texts", ...)` spawns sidecar IPC.
- Batch size 32 per embed call.

---

## Phase 3+: Not started

Phases 3 (suggestion review UI), 4 (LLM cluster labels), 5 (new-note flow flip), 6 (backfill), 7 (legacy deprecation) untouched.

---

## Picking Up Later

Recommended next chunk: finish Phase 1 TODO list, in order:
1. PATCH/DELETE hooks on `notes/[noteId]`.
2. Group delete hook.
3. New semantic endpoints (start with `GET /semantic/notes`, then bulk uploads, then suggestions accept/dismiss).
4. `SEMANTIC_NOTES_ENABLED` flag.

Then jump to Phase 2 desktop scaffolding (utilities first, sidecar last).

## Open Decisions

- Exact Python sidecar packaging (PyInstaller vs Nuitka vs bundling Python runtime) — needs verification against Tauri bundle pipeline on Windows + macOS.
- Whether `replaceSemanticEdges` should scope-replace only edges touching the embedded note set, or globally wipe all `source=semantic` edges. Plan implies global; current TODO will follow plan.
- Whether the existing `categorize/` and `enhance/` sub-routes need semantic-stale marking when they mutate content.
