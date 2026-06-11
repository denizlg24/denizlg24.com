# Semantic Notes And Bookmarks Migration Plan

## Summary

Replace the current per-note LLM categorization path with a hybrid system:

- **Local embeddings in `denizlg24-app`** for cheap semantic understanding.
- **MongoDB-backed semantic metadata in `portfolio-2026`** for persistence and API access.
- **Existing `NoteGroup` hierarchy remains the source of truth** for human organization.
- **Semantic clustering suggests groups, edges, tags, and hierarchy changes**, but user-confirmed hierarchy wins.
- **LLM usage is reduced to optional cluster naming/summarization**, not note-by-note classification.

Current repo facts this plan uses:

- API app: `portfolio-2026`, Next.js API routes under `app/api/admin`.
- Desktop app: `denizlg24-app`, Tauri + Next.js, consumes `https://denizlg24.com/api/admin`.
- Storage: MongoDB via Mongoose.
- Current models:
  - `KnowledgeNote` in `knowledge_notes`
  - `KnowledgeNoteGroup` in `knowledge_note_groups`
  - `KnowledgeNoteEdge` in `knowledge_note_edges`
- Current graph frontend already supports:
  - note nodes
  - group nodes
  - group parent links
  - note-note edges
  - `react-force-graph-2d`

## Goals

1. Cut routine categorization cost close to zero.
2. Keep readable organization like:
   ```txt
   University
     -> Algorithms
       -> Graph Traversal
         -> Dijkstra note
   ```
3. Improve graph usefulness with semantic edges generated from embeddings.
4. Preserve all existing groups, tags, notes, links, and current graph behavior during migration.
5. Allow user review for generated groups and placements.
6. Keep Vercel serverless lightweight: CRUD, persistence, and optional LLM labels only.
7. Put CPU-heavy embedding/clustering work in `denizlg24-app`, managed by Tauri.

## Non-Goals

- Do not replace the user-controlled hierarchy with opaque clustering.
- Do not require a separate always-on backend worker.
- Do not depend on Vercel functions for local ML inference or long-running clustering.
- Do not delete existing LLM categorization until semantic migration is verified.
- Do not migrate away from MongoDB/Mongoose in this project.

## Key Product Model

Use three parallel concepts:

```txt
1. Human hierarchy
   NoteGroup parentId tree + note.groupIds

2. Semantic graph
   NoteEmbedding + NoteEdge(source = semantic)

3. Reviewable suggestions
   Suggested groups, placements, tags, edges, and cluster labels
```

Important rule:

```txt
User-confirmed hierarchy is source of truth.
Semantic clustering is a suggestion engine and graph enhancer.
```

## Model Choice

Use a local multilingual embedding model in the desktop app:

```txt
Model: intfloat/multilingual-e5-small
Embedding dimension: 384
Input prefix: "passage: "
```

Reasoning:

- Works better than English-only models if notes/bookmarks include English, Portuguese, or mixed content.
- Small enough for local desktop use.
- Good enough for semantic grouping, related-note edges, and class/topic suggestions.

Canonical embedding text:

```txt
passage: {title}

{description}

{siteName}
{url domain}

{content excerpt up to 4000 chars}

tags: {comma-separated tags}
groups: {current group path labels}
```

For notes with only a URL and little content, include title, description, siteName, domain, and existing tags/groups.

## Runtime Placement

### `denizlg24-app`

Add the semantic engine here.

Responsibilities:

- Download/load embedding model.
- Generate embeddings for notes/bookmarks.
- Compute cosine similarities.
- Build semantic note-note edges.
- Detect clusters.
- Generate local placement/tag suggestions.
- Push results to `portfolio-2026` API.
- Show migration/review UI.

Implementation default:

- Add a Tauri-managed semantic module.
- Prefer a Rust implementation if practical.
- If Rust embedding integration becomes too slow to implement, use a bundled sidecar process managed by Tauri.
- The sidecar must be started/stopped by Tauri and not require the user to install Python, Bun, Ollama, or external services manually.

### `portfolio-2026`

Keep serverless API lightweight.

Responsibilities:

- Store embeddings and semantic metadata.
- Expose sync endpoints.
- Serve graph data with semantic metadata.
- Run optional LLM label generation for clusters.
- Keep existing note/group/edge CRUD behavior compatible.

Do not run local embedding inference or full clustering in Vercel.

## Database Changes In `portfolio-2026`

### Extend `KnowledgeNote`

Add fields to `models/Note.ts`:

```ts
semanticStatus?: "pending" | "embedded" | "stale" | "failed";
semanticContentHash?: string;
semanticUpdatedAt?: Date;
semanticError?: string;
```

Rules:

- New/updated notes default to `semanticStatus = "pending"`.
- If title/content/url/description/siteName/tags/groupIds change, mark `semanticStatus = "stale"` unless the update comes from the semantic sync endpoint with a matching hash.
- Existing notes without these fields are treated as `pending`.

### Extend `KnowledgeNoteGroup`

Add fields to `models/NoteGroup.ts`:

```ts
kind?: "manual" | "generated" | "system";
source?: "user" | "llm" | "semantic" | "migration";
lockedByUser?: boolean;
semanticRunId?: mongoose.Types.ObjectId;
semanticClusterKey?: string;
confidence?: number;
aliases?: string[];
```

Defaults:

```ts
kind = autoCreated ? "generated" : "manual"
source = autoCreated ? "llm" : "user"
lockedByUser = !autoCreated
aliases = []
```

Rules:

- Any group edited manually becomes `lockedByUser = true`, `source = "user"`.
- Semantic jobs may suggest changes to locked groups but must not auto-rename or auto-move them.

### Extend `KnowledgeNoteEdge`

Add fields to `models/NoteEdge.ts`:

```ts
source?: "manual" | "llm" | "semantic" | "migration";
model?: string;
runId?: mongoose.Types.ObjectId;
metadata?: {
  similarity?: number;
  sharedGroupIds?: string[];
  explanation?: string;
};
```

Defaults:

```ts
source = "llm" for existing edges created by current categorizer
```

Unique index stays:

```ts
{ from: 1, to: 1 }
```

Upsert rule:

- Semantic edges can update semantic metadata/strength.
- Manual/LLM edges should not be deleted by semantic rebuilds unless explicitly replaced.

### Add `KnowledgeNoteEmbedding`

Create `models/NoteEmbedding.ts`.

Collection:

```txt
knowledge_note_embeddings
```

Schema:

```ts
interface INoteEmbedding {
  noteId: ObjectId;
  model: string;
  dimension: number;
  vector: number[];
  contentHash: string;
  inputTextPreview: string;
  createdAt: Date;
  updatedAt: Date;
}
```

Indexes:

```ts
{ noteId: 1, model: 1 } unique
{ contentHash: 1 }
{ updatedAt: -1 }
```

Decision:

- Store vectors in MongoDB as `number[]`.
- Do not require MongoDB Atlas Vector Search for the first implementation.
- Desktop app fetches embeddings and computes nearest neighbors locally.

### Add `KnowledgeSemanticRun`

Create `models/KnowledgeSemanticRun.ts`.

Collection:

```txt
knowledge_semantic_runs
```

Schema:

```ts
interface IKnowledgeSemanticRun {
  status: "running" | "completed" | "failed";
  model: string;
  startedAt: Date;
  completedAt?: Date;
  initiatedBy: "desktop" | "script";
  noteCount: number;
  embeddedCount: number;
  staleCount: number;
  edgeCount: number;
  clusterCount: number;
  error?: string;
  parameters: {
    topK: number;
    minSimilarity: number;
    strongSimilarity: number;
    clusterMinSize: number;
    maxGroupsPerNote: number;
  };
}
```

Default parameters:

```ts
topK = 8
minSimilarity = 0.72
strongSimilarity = 0.82
clusterMinSize = 3
maxGroupsPerNote = 3
```

### Add `KnowledgeSemanticSuggestion`

Create `models/KnowledgeSemanticSuggestion.ts`.

Collection:

```txt
knowledge_semantic_suggestions
```

Schema:

```ts
type SuggestionType =
  | "join-group"
  | "create-group"
  | "rename-group"
  | "move-group"
  | "add-tags"
  | "add-edge"
  | "archive-edge"
  | "cluster-label";

interface IKnowledgeSemanticSuggestion {
  runId: ObjectId;
  type: SuggestionType;
  status: "pending" | "accepted" | "dismissed" | "superseded";
  noteId?: ObjectId;
  groupId?: ObjectId;
  targetGroupId?: ObjectId;
  proposedParentId?: ObjectId | null;
  proposedName?: string;
  proposedDescription?: string;
  proposedTags?: string[];
  proposedRelatedNoteIds?: ObjectId[];
  confidence: number;
  reason: string;
  source: "semantic" | "llm-label";
  createdAt: Date;
  updatedAt: Date;
  decidedAt?: Date;
}
```

Indexes:

```ts
{ status: 1, type: 1 }
{ runId: 1 }
{ noteId: 1, status: 1 }
{ groupId: 1, status: 1 }
```

## API Changes In `portfolio-2026`

All endpoints remain under:

```txt
/api/admin
```

All require existing `requireAdmin`.

### Existing `GET /api/admin/notes`

Extend response.

Current:

```ts
{
  notes: INote[];
  groups: INoteGroup[];
  edges: INoteEdge[];
  stats: { total: number; groups: number; edges: number };
}
```

New:

```ts
{
  notes: INote[];
  groups: INoteGroup[];
  edges: INoteEdge[];
  stats: {
    total: number;
    groups: number;
    edges: number;
    semanticPending: number;
    semanticStale: number;
    suggestionsPending: number;
  };
  semantic?: {
    latestRun?: {
      _id: string;
      status: "running" | "completed" | "failed";
      model: string;
      completedAt?: string;
      edgeCount: number;
      clusterCount: number;
    };
  };
}
```

Backwards compatibility:

- Existing desktop code can ignore new fields.

### Existing `POST /api/admin/notes`

Change behavior:

- Keep current LLM categorization available behind request body flag.
- New default for desktop-created notes/bookmarks:

```ts
skipCategorize = true unless body.useLegacyLlmCategorization === true
```

After creating note:

```ts
semanticStatus = "pending"
```

Return created note as today.

### Existing `PATCH/PUT /api/admin/notes/:noteId`

After user edits semantic-affecting fields:

```ts
semanticStatus = "stale"
```

Semantic-affecting fields:

```txt
title
content
url
description
siteName
tags
groupIds
class
```

Do not mark stale if patch body includes:

```ts
semanticContentHash
semanticStatus: "embedded"
```

from the semantic sync endpoint only.

### New `GET /api/admin/semantic/notes`

Used by desktop semantic engine.

Query params:

```txt
status=pending|stale|all
includeEmbeddings=true|false
limit=number
```

Response:

```ts
{
  notes: Array<{
    _id: string;
    title: string;
    content: string;
    url?: string;
    description?: string;
    siteName?: string;
    tags: string[];
    groupIds: string[];
    class?: string;
    status: "open" | "archived";
    updatedAt: string;
    semanticStatus?: string;
    semanticContentHash?: string;
  }>;
  groups: INoteGroup[];
  embeddings?: Array<{
    noteId: string;
    model: string;
    dimension: number;
    vector: number[];
    contentHash: string;
    updatedAt: string;
  }>;
}
```

Default:

```txt
status=all
includeEmbeddings=true
limit=5000
```

### New `POST /api/admin/semantic/runs`

Create run.

Request:

```ts
{
  model: "intfloat/multilingual-e5-small";
  parameters?: {
    topK?: number;
    minSimilarity?: number;
    strongSimilarity?: number;
    clusterMinSize?: number;
    maxGroupsPerNote?: number;
  };
}
```

Response:

```ts
{ run: IKnowledgeSemanticRun }
```

### New `POST /api/admin/semantic/embeddings/bulk`

Desktop uploads embeddings.

Request:

```ts
{
  runId: string;
  model: string;
  dimension: 384;
  embeddings: Array<{
    noteId: string;
    vector: number[];
    contentHash: string;
    inputTextPreview: string;
  }>;
}
```

Validation:

- `dimension` must equal `384`.
- `vector.length` must equal `384`.
- `embeddings.length <= 100`.

Behavior:

- Upsert by `{ noteId, model }`.
- Set note:
  ```ts
  semanticStatus = "embedded"
  semanticContentHash = contentHash
  semanticUpdatedAt = now
  unset semanticError
  ```

Response:

```ts
{ updated: number }
```

### New `POST /api/admin/semantic/edges/bulk`

Desktop uploads semantic edges.

Request:

```ts
{
  runId: string;
  model: string;
  edges: Array<{
    from: string;
    to: string;
    strength: number;
    similarity: number;
    reason?: string;
  }>;
  replaceSemanticEdges?: boolean;
}
```

Default:

```ts
replaceSemanticEdges = true
```

Behavior:

- If `replaceSemanticEdges`, delete only edges with:
  ```ts
  source = "semantic"
  ```
- Upsert edges normalized so `from < to` lexicographically to avoid duplicate reverse edges.
- Set:
  ```ts
  source = "semantic"
  model = request.model
  runId = request.runId
  strength = similarity
  metadata.similarity = similarity
  reason = reason ?? "Semantically similar"
  ```

Response:

```ts
{ upserted: number; deleted: number }
```

### New `POST /api/admin/semantic/suggestions/bulk`

Desktop uploads suggestions.

Request:

```ts
{
  runId: string;
  suggestions: Array<{
    type: SuggestionType;
    noteId?: string;
    groupId?: string;
    targetGroupId?: string;
    proposedParentId?: string | null;
    proposedName?: string;
    proposedDescription?: string;
    proposedTags?: string[];
    proposedRelatedNoteIds?: string[];
    confidence: number;
    reason: string;
    source: "semantic";
  }>;
}
```

Behavior:

- Mark previous pending suggestions from older runs as `superseded` when they target the same note/group/type.
- Insert new suggestions as `pending`.
- Do not directly mutate notes/groups.

Response:

```ts
{ inserted: number; superseded: number }
```

### New `GET /api/admin/semantic/suggestions`

Query params:

```txt
status=pending|accepted|dismissed|superseded
type=optional
```

Response:

```ts
{
  suggestions: IKnowledgeSemanticSuggestion[];
}
```

### New `POST /api/admin/semantic/suggestions/:id/accept`

Accept one suggestion and mutate the canonical models.

Behavior by type:

- `join-group`
  - Add `targetGroupId` to `note.groupIds`.
  - Run existing `pruneGroupIds`.
  - Mark note `semanticStatus = "stale"` because group context changed.
- `create-group`
  - Create `NoteGroup` with:
    ```ts
    kind = "generated"
    source = "semantic"
    lockedByUser = false
    autoCreated = true
    semanticRunId = runId
    ```
- `rename-group`
  - Only allowed if group is not `lockedByUser`.
  - Rename group and keep `source = "semantic"`.
- `move-group`
  - Only allowed if group is not `lockedByUser`.
  - Update `parentId`.
- `add-tags`
  - Merge tags onto note.
- `add-edge`
  - Upsert semantic/manual edge depending on suggestion source.
- `cluster-label`
  - Update generated group name/description only if not `lockedByUser`.

Response:

```ts
{
  suggestion: IKnowledgeSemanticSuggestion;
  note?: INote;
  group?: INoteGroup;
}
```

### New `POST /api/admin/semantic/suggestions/:id/dismiss`

Sets:

```ts
status = "dismissed"
decidedAt = now
```

No model mutation.

### New `POST /api/admin/semantic/runs/:id/complete`

Request:

```ts
{
  status: "completed" | "failed";
  embeddedCount: number;
  staleCount: number;
  edgeCount: number;
  clusterCount: number;
  error?: string;
}
```

Response:

```ts
{ run: IKnowledgeSemanticRun }
```

### New `POST /api/admin/semantic/label-clusters`

Optional LLM endpoint.

Request:

```ts
{
  runId: string;
  clusters: Array<{
    clusterKey: string;
    parentGroupId?: string;
    representativeNotes: Array<{
      id: string;
      title: string;
      excerpt: string;
      url?: string;
      groupPathLabels: string[];
      tags: string[];
    }>;
  }>;
}
```

Response:

```ts
{
  labels: Array<{
    clusterKey: string;
    name: string;
    description: string;
    tags: string[];
    confidence: number;
  }>;
}
```

Rules:

- One LLM call per batch of clusters, not per note.
- Max 10 clusters per request.
- Use existing `logLlmUsage`.
- Source should be:
  ```txt
  semantic-cluster-label
  ```

## Desktop App Changes In `denizlg24-app`

### Types

Extend `lib/data-types.ts`.

Add semantic fields to `INote`:

```ts
semanticStatus?: "pending" | "embedded" | "stale" | "failed";
semanticContentHash?: string;
semanticUpdatedAt?: string;
semanticError?: string;
```

Add semantic fields to `INoteGroup`:

```ts
kind?: "manual" | "generated" | "system";
source?: "user" | "llm" | "semantic" | "migration";
lockedByUser?: boolean;
semanticRunId?: string;
semanticClusterKey?: string;
confidence?: number;
aliases?: string[];
```

Add semantic fields to `INoteEdge`:

```ts
source?: "manual" | "llm" | "semantic" | "migration";
model?: string;
runId?: string;
metadata?: {
  similarity?: number;
  sharedGroupIds?: string[];
  explanation?: string;
};
```

Add:

```ts
export interface INoteEmbedding {
  noteId: string;
  model: string;
  dimension: number;
  vector: number[];
  contentHash: string;
  updatedAt: string;
}

export interface ISemanticSuggestion {
  _id: string;
  runId: string;
  type:
    | "join-group"
    | "create-group"
    | "rename-group"
    | "move-group"
    | "add-tags"
    | "add-edge"
    | "archive-edge"
    | "cluster-label";
  status: "pending" | "accepted" | "dismissed" | "superseded";
  noteId?: string;
  groupId?: string;
  targetGroupId?: string;
  proposedParentId?: string | null;
  proposedName?: string;
  proposedDescription?: string;
  proposedTags?: string[];
  proposedRelatedNoteIds?: string[];
  confidence: number;
  reason: string;
  source: "semantic" | "llm-label";
  createdAt: string;
  updatedAt: string;
}
```

### API Wrapper

No base pattern change required.

Add calls through existing `denizApi.GET/POST/PATCH/DELETE`.

Endpoints used:

```txt
semantic/notes
semantic/runs
semantic/embeddings/bulk
semantic/edges/bulk
semantic/suggestions
semantic/suggestions/bulk
semantic/suggestions/:id/accept
semantic/suggestions/:id/dismiss
semantic/runs/:id/complete
semantic/label-clusters
```

### Semantic Engine Module

Create a desktop-only semantic service.

Suggested structure:

```txt
denizlg24-app/
  lib/semantic/
    content-hash.ts
    embedding-text.ts
    cosine.ts
    nearest-neighbors.ts
    clustering.ts
    suggestions.ts
    semantic-sync.ts
```

If embedding is implemented in Rust/Tauri:

```txt
src-tauri/src/semantic.rs
src-tauri/src/main.rs
```

Expose Tauri command:

```ts
invoke("embed_texts", {
  model: "intfloat/multilingual-e5-small",
  inputs: string[]
})
```

Return:

```ts
{
  model: string;
  dimension: 384;
  embeddings: number[][];
}
```

Batch size default:

```txt
32 notes per embedding batch
```

### Content Hash

Use stable SHA-256 over normalized semantic input.

Hash input object:

```ts
{
  model: "intfloat/multilingual-e5-small",
  title,
  content,
  url,
  description,
  siteName,
  tags: sorted tags,
  groupIds: sorted group ids,
  class
}
```

Rules:

- If hash matches existing embedding, skip re-embedding.
- If note has no embedding or hash mismatch, embed.

### Similarity

Use cosine similarity on normalized vectors.

For each note:

- Find top `topK = 8` nearest neighbors.
- Keep edges with similarity `>= 0.72`.
- Mark `>= 0.82` as strong.

Edge strength:

```ts
strength = Math.min(1, Math.max(0, (similarity - 0.72) / (1 - 0.72)))
```

But store raw similarity in `metadata.similarity`.

Graph display can continue using `strength`.

### Clustering Algorithm

Use graph-based clustering, not K-means.

Implementation default:

1. Build undirected graph from semantic edges where:
   ```txt
   similarity >= 0.72
   ```
2. Find connected components.
3. Split overly broad components by increasing threshold to `0.82`.
4. Ignore clusters with fewer than `3` notes.
5. For each cluster, determine:
   - representative notes: top 5 by average similarity to other cluster members
   - dominant existing parent group, if any
   - candidate generated topic group

This avoids choosing `k` and aligns with the existing graph UI.

Later enhancement:

- Add Louvain/Leiden community detection if connected components are too coarse.

### Hierarchy Suggestion Rules

For every cluster:

1. Find all existing group paths of member notes.
2. If 60%+ of notes share the same top-level ancestor, propose that as parent.
3. If 50%+ share the same class/folder group, propose that as parent.
4. If no dominant parent exists, do not auto-create a group; emit low-confidence suggestion only.

Examples:

```txt
University -> Algorithms -> generated "Graph Traversal"
University -> Databases -> generated "Query Optimization"
Personal -> Projects -> generated "Tauri Desktop"
```

### Placement Suggestion Rules

For each note:

- If nearest group centroid similarity `>= 0.82`, create `join-group` suggestion with high confidence.
- If `0.72 <= similarity < 0.82`, create `join-group` suggestion with medium confidence.
- If below `0.72`, create no group suggestion.

Group centroid:

```ts
average embedding of notes currently in that group
```

Do not suggest adding a note to an ancestor if it is already in a descendant.

### Tag Suggestion Rules

For each cluster:

- Generate candidate tags from:
  - existing tags in cluster
  - frequent title words
  - frequent domain names for bookmarks
  - optional LLM label output

Rules:

```txt
max 5 tags per suggestion
lowercase
no generic tags like note, bookmark, article, link, misc
```

### Generated Label Strategy

Default non-LLM label:

- Use the most frequent meaningful phrase from titles.
- Prefer 2-4 words.
- Title Case for group names.
- Lowercase for tags.

Optional better label:

- Call `POST /semantic/label-clusters` with representative notes.
- Create `cluster-label` or `create-group` suggestions from returned labels.

Use LLM only when:

```txt
cluster size >= 3
cluster does not match an existing group name
cluster confidence >= 0.72
```

## Notes UI Changes

### Notes Header

Add compact semantic status indicator:

```txt
Semantic: 12 pending · 3 suggestions
```

Click opens semantic panel.

### Semantic Panel

Add a right-side or modal panel in `app/dashboard/notes`.

Views:

```txt
Overview
Suggestions
Migration
Settings
```

Overview shows:

- latest run status
- model
- embedded notes count
- pending/stale count
- semantic edges count
- pending suggestions count

Suggestions list supports:

- Accept
- Dismiss
- Open affected note/group
- Batch accept selected
- Filter by type

Suggestion cards must show:

```txt
type
confidence
reason
affected note/group
proposed result
```

### Graph View

Update graph visuals:

- Existing membership links unchanged.
- Semantic edges:
  - lower opacity
  - line width based on similarity
  - optional label/tooltip showing similarity and reason
- Generated groups:
  - visually distinguish with subtle dashed outline or "generated" badge in detail panel, not in graph node text.
- Locked/manual groups remain normal.

### Note Detail

Add semantic related notes section:

```txt
Related
- note title
- similarity %
- reason/source
```

Separate relation source:

```txt
Manual/LLM
Semantic
```

Add action:

```txt
Refresh semantic suggestions for this note
```

This action runs local single-note embedding and nearest-neighbor update, then syncs.

### Group Detail

Show:

- `source`
- `lockedByUser`
- aliases
- generated confidence
- related suggestions

When user edits a group name, description, color, or parent:

```txt
lockedByUser = true
source = user
```

## Migration Plan

### Phase 0: Backup And Feature Flag

Add env/config flag in both projects:

```txt
SEMANTIC_NOTES_ENABLED=false
```

Desktop setting:

```txt
Enable semantic notes
```

Before running migration:

- Create MongoDB backup of:
  ```txt
  knowledge_notes
  knowledge_note_groups
  knowledge_note_edges
  ```
- Do not remove legacy categorization route.

Acceptance:

- Existing notes page works with flag off.
- Existing `POST /notes` still works.

### Phase 1: API Schema Additions

Implement:

- extended fields on `Note`, `NoteGroup`, `NoteEdge`
- new models:
  - `NoteEmbedding`
  - `KnowledgeSemanticRun`
  - `KnowledgeSemanticSuggestion`
- new serializers for semantic fields
- new API endpoints listed above

Compatibility migration script:

```txt
scripts/migrate-semantic-defaults.ts
```

Script behavior:

- For all existing notes:
  ```ts
  semanticStatus = "pending" if missing
  ```
- For all existing groups:
  ```ts
  kind = autoCreated ? "generated" : "manual"
  source = autoCreated ? "llm" : "user"
  lockedByUser = !autoCreated
  aliases = []
  ```
- For all existing edges:
  ```ts
  source = "llm"
  ```

Acceptance:

- `GET /api/admin/notes` returns old shape plus new semantic fields.
- Old desktop app version does not break.
- New semantic endpoints reject invalid API keys.

### Phase 2: Desktop Semantic Engine

Implement local semantic service.

Flow:

1. Fetch notes/groups/embeddings:
   ```txt
   GET semantic/notes?status=all&includeEmbeddings=true
   ```
2. Compute content hash for each note.
3. Embed only notes with missing/stale embeddings.
4. Upload embeddings in batches of 100.
5. Compute nearest-neighbor edges from all embeddings.
6. Upload semantic edges.
7. Build clusters.
8. Upload suggestions.
9. Complete semantic run.

Acceptance:

- Running semantic migration on a small dataset produces embeddings.
- Re-running with no content changes skips embedding work.
- Semantic edges appear in graph.
- No LLM calls happen in this phase.

### Phase 3: Suggestion Review UI

Add semantic panel in notes UI.

Must support:

- list pending suggestions
- accept one suggestion
- dismiss one suggestion
- batch accept `join-group` and `add-tags`
- refresh suggestions after action
- show confidence/reason

Acceptance:

- Accepting a `join-group` suggestion updates the note and graph.
- Dismissing a suggestion removes it from pending view.
- Editing a generated group marks it locked/user-owned.

### Phase 4: Optional LLM Cluster Labels

Implement `POST /semantic/label-clusters`.

Desktop flow:

1. Cluster locally.
2. Send representatives for unlabeled clusters.
3. API calls Anthropic once per batch.
4. API logs usage with existing LLM usage model.
5. Desktop converts labels into suggestions.

Acceptance:

- LLM cost is proportional to cluster count, not note count.
- Label generation can be disabled.
- If LLM fails, local phrase labels are still used.

### Phase 5: Change New Note Flow

Update desktop note/link creation.

Default behavior:

```ts
POST /notes {
  ...body,
  skipCategorize: true
}
```

After create:

1. Add note to UI immediately.
2. Mark semantic status as pending.
3. Trigger local single-note semantic refresh:
   - embed new note
   - compare against existing embeddings
   - upload embedding
   - upload top edges
   - upload suggestions

Keep manual button:

```txt
Categorize with legacy LLM
```

Acceptance:

- Pasting/importing a link no longer calls LLM by default.
- New note gets related semantic edges shortly after creation.
- User can still invoke legacy categorization manually.

### Phase 6: Backfill Existing Library

Run full migration from desktop semantic panel:

```txt
Semantic Notes -> Migration -> Run Full Backfill
```

Backfill steps:

1. Create run.
2. Fetch all notes.
3. Embed all pending/stale notes.
4. Upload embeddings.
5. Rebuild semantic edges.
6. Generate suggestions.
7. Optionally label clusters.
8. Complete run.

Progress states:

```txt
Loading notes
Embedding 12 / 400
Uploading embeddings
Building graph
Generating suggestions
Complete
```

Failure behavior:

- Mark run failed.
- Store error.
- Keep successfully uploaded embeddings.
- Next run resumes by content hash.

Acceptance:

- Existing groups remain unchanged until suggestions are accepted.
- Existing note-note edges are not deleted.
- Existing groupIds/tags are not removed.
- Backfill can be safely run multiple times.

### Phase 7: Legacy LLM Deprecation

After semantic results are good:

- Keep endpoint:
  ```txt
  POST /notes/:id/categorize
  ```
- Rename UI action:
  ```txt
  Legacy AI Categorize
  ```
- Hide it behind overflow menu or semantic panel.
- Track usage from `llmUsage` and compare before/after.

Acceptance:

- Routine new link imports do not call LLM.
- LLM categorization remains available for hard cases.

## Migration Of Current Data

Current data maps cleanly:

### Existing Groups

Existing `knowledge_note_groups` become the hierarchy baseline.

Mapping:

```txt
autoCreated=false -> manual, source=user, lockedByUser=true
autoCreated=true  -> generated, source=llm, lockedByUser=false
```

No group is deleted or renamed during migration.

### Existing Note Group Memberships

Existing `note.groupIds` remain canonical.

Semantic suggestions may propose additions but do not remove existing memberships automatically.

### Existing Tags

Existing `note.tags` remain.

Semantic tag suggestions only add tags after review.

### Existing Edges

Existing `knowledge_note_edges` remain.

Set:

```txt
source = "llm"
```

Semantic rebuild only replaces edges with:

```txt
source = "semantic"
```

### Existing `class` Field

Keep `note.class` for now.

Use it as an extra semantic signal and search field.

Do not use it as the hierarchy source of truth.

Future cleanup can migrate `class` values into groups, but that is out of scope for this implementation.

## Edge Cases

### Very Small Dataset

If fewer than 3 notes:

- Generate embeddings.
- Generate nearest-neighbor edges if similarity is high.
- Do not create cluster/group suggestions.

### Isolated Note

If no similarity above `0.72`:

- No semantic edge.
- No group suggestion.
- Keep `semanticStatus = embedded`.

### Duplicate Or Near-Duplicate Bookmark

If similarity `>= 0.95` and URL differs:

- Create high-confidence `add-edge` suggestion.
- Do not auto-merge notes.

### Edited Note

When note content changes:

- Mark stale.
- Re-embed on next semantic run.
- Replace semantic edges involving that note.
- Supersede pending suggestions for that note.

### Deleted Note

Existing delete route must also delete:

```txt
NoteEmbedding where noteId = deleted note
KnowledgeSemanticSuggestion where noteId = deleted note
Semantic edges already deleted by current NoteEdge deletion logic
```

### Deleted Group

Existing group delete route must also:

- Dismiss/supersede pending suggestions targeting that group.
- Leave embeddings unchanged.
- Mark affected notes `semanticStatus = "stale"` because group context changed.

### Locked Group

If `lockedByUser = true`:

- Do not auto-rename.
- Do not auto-move.
- Allow suggestions only.

### Conflicting Suggestions

If accepting one suggestion makes another invalid:

- Mark invalid suggestion `superseded`.
- Examples:
  - accepted create-group makes duplicate create-group obsolete
  - accepted rename-group supersedes older rename suggestions for same group

## Testing Plan

### API Tests / Static Validation

Add tests or route-level validation checks for:

- `NoteEmbedding` rejects wrong vector dimension.
- bulk embedding endpoint rejects batches over 100.
- semantic edge upload only deletes `source = "semantic"` edges.
- accepting `join-group` prunes redundant ancestor groups.
- accepting `rename-group` fails for locked groups.
- deleting a note cleans embeddings/suggestions.
- old `GET /notes` consumer shape remains compatible.

### Desktop Unit Tests

Test pure functions:

- content hash is stable with reordered tags/groupIds.
- embedding text builder handles blank content and URL-only bookmarks.
- cosine similarity returns expected values.
- nearest-neighbor selection excludes self.
- graph clustering ignores clusters smaller than 3.
- placement suggestions do not suggest redundant ancestor groups.
- tag suggestions filter generic terms.

### Manual QA Scenarios

1. Import a new URL.
   - No LLM call.
   - Note appears.
   - Semantic status becomes pending then embedded.
   - Related edges appear.

2. Create `University -> Algorithms`.
   - Add several algorithm notes.
   - Run semantic backfill.
   - System suggests topic groups under `Algorithms`.

3. Rename generated group.
   - Group becomes locked.
   - Future semantic runs do not rename it.

4. Edit note content.
   - Semantic status becomes stale.
   - Next run re-embeds only that note.

5. Run full backfill twice.
   - Second run skips unchanged embeddings.
   - Edges/suggestions remain consistent.

6. Disable semantic flag.
   - Existing notes UI still works.
   - Legacy categorization still works.

## Rollout Plan

1. Merge API schema and endpoints behind `SEMANTIC_NOTES_ENABLED=false`.
2. Deploy `portfolio-2026`.
3. Release desktop app with semantic panel hidden unless enabled.
4. Run migration defaults script.
5. Enable semantic locally in desktop settings.
6. Run backfill on a small subset or local/dev DB.
7. Run full backfill.
8. Review suggestions manually.
9. Switch desktop new note creation to `skipCategorize: true`.
10. Monitor LLM usage page for reduced categorization cost.

## Monitoring

Use existing LLM usage dashboard to track:

```txt
source = note-categorize
source = categorize-notes
source = semantic-cluster-label
```

Add semantic stats to notes response:

```txt
semanticPending
semanticStale
suggestionsPending
latestRun.status
latestRun.edgeCount
latestRun.clusterCount
```

Desktop semantic panel should show last run failure reason.

## Implementation Order

1. `portfolio-2026`: add/extend Mongoose models.
2. `portfolio-2026`: add serializers and migration defaults script.
3. `portfolio-2026`: add semantic API endpoints.
4. `denizlg24-app`: extend TypeScript data types.
5. `denizlg24-app`: add semantic pure utility modules.
6. `denizlg24-app`: add local embedding command/sidecar.
7. `denizlg24-app`: add semantic sync runner.
8. `denizlg24-app`: add semantic panel and suggestion review UI.
9. `denizlg24-app`: update graph rendering for semantic edges.
10. `denizlg24-app`: switch new note/link default to skip legacy LLM.
11. `portfolio-2026`: add optional cluster label endpoint.
12. Full backfill and QA.

## Explicit Defaults Chosen

- Embedding model: `intfloat/multilingual-e5-small`.
- Embedding dimension: `384`.
- Similarity algorithm: cosine similarity.
- Clustering v1: thresholded semantic graph connected components with high-threshold splitting.
- `topK`: `8`.
- `minSimilarity`: `0.72`.
- `strongSimilarity`: `0.82`.
- Minimum cluster size: `3`.
- Max groups per note: `3`.
- Serverless API does not perform embeddings or clustering.
- MongoDB stores vectors as arrays; no Atlas Vector Search dependency for v1.
- Existing `NoteGroup` hierarchy remains canonical.
- Existing `note.groupIds` remains canonical placement storage.
- Existing LLM categorization remains available manually.
- New desktop note/link creation skips LLM by default once semantic engine is enabled.
