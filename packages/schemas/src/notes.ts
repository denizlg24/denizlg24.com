import { z } from "zod";

export const noteSchema = z.object({
  _id: z.string(),
  title: z.string(),
  content: z.string(),
  url: z.string().optional(),
  description: z.string().optional(),
  siteName: z.string().optional(),
  favicon: z.string().optional(),
  image: z.string().optional(),
  publishedDate: z.string().optional(),
  tags: z.array(z.string()),
  groupIds: z.array(z.string()),
  manualGroupIds: z.array(z.string()).optional(),
  status: z.enum(["open", "archived"]),
  class: z.string().optional(),
  paperId: z.string().optional(),
  semanticKeywords: z.array(z.string()).optional(),
  semanticSummary: z.string().optional(),
  semanticModel: z.string().optional(),
  semanticStatus: z.enum(["pending", "embedded", "stale", "failed"]).optional(),
  semanticContentHash: z.string().optional(),
  semanticUpdatedAt: z.string().optional(),
  semanticError: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type INote = z.infer<typeof noteSchema>;

export const noteGroupSchema = z.object({
  _id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  color: z.string().optional(),
  parentId: z.string().nullable().optional(),
  autoCreated: z.boolean(),
  kind: z.enum(["manual", "generated", "system"]).optional(),
  source: z.enum(["user", "llm", "semantic", "migration"]).optional(),
  lockedByUser: z.boolean().optional(),
  semanticRunId: z.string().optional(),
  semanticClusterKey: z.string().optional(),
  confidence: z.number().optional(),
  aliases: z.array(z.string()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type INoteGroup = z.infer<typeof noteGroupSchema>;

export const noteEdgeSchema = z.object({
  _id: z.string(),
  from: z.string(),
  to: z.string(),
  strength: z.number(),
  reason: z.string().optional(),
  source: z.enum(["manual", "llm", "semantic", "migration"]).optional(),
  model: z.string().optional(),
  runId: z.string().optional(),
  metadata: z
    .object({
      similarity: z.number().optional(),
      sharedGroupIds: z.array(z.string()).optional(),
      explanation: z.string().optional(),
    })
    .optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type INoteEdge = z.infer<typeof noteEdgeSchema>;

export const noteGraphSchema = z.object({
  notes: z.array(noteSchema),
  groups: z.array(noteGroupSchema),
  edges: z.array(noteEdgeSchema),
  stats: z.object({
    total: z.number(),
    groups: z.number(),
    edges: z.number(),
    semanticPending: z.number().optional(),
    semanticStale: z.number().optional(),
    suggestionsPending: z.number().optional(),
  }),
  semantic: z
    .object({
      latestRun: z
        .object({
          _id: z.string(),
          status: z.enum(["running", "completed", "failed"]),
          model: z.string(),
          completedAt: z.string().optional(),
          edgeCount: z.number(),
          clusterCount: z.number(),
        })
        .optional(),
    })
    .optional(),
});
export type INoteGraph = z.infer<typeof noteGraphSchema>;

export const semanticRunSchema = z.object({
  _id: z.string(),
  status: z.enum(["running", "completed", "failed"]),
  model: z.string(),
  initiatedBy: z.enum(["desktop", "script"]),
  noteCount: z.number(),
  embeddedCount: z.number(),
  staleCount: z.number(),
  edgeCount: z.number(),
  clusterCount: z.number(),
  parameters: z.object({
    topK: z.number(),
    minSimilarity: z.number(),
    strongSimilarity: z.number(),
    clusterMinSize: z.number(),
    maxGroupsPerNote: z.number(),
  }),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  error: z.string().optional(),
});
export type ISemanticRun = z.infer<typeof semanticRunSchema>;

export const semanticSuggestionSchema = z.object({
  _id: z.string(),
  runId: z.string(),
  type: z.enum([
    "join-group",
    "create-group",
    "rename-group",
    "move-group",
    "add-tags",
    "add-edge",
    "archive-edge",
    "cluster-label",
  ]),
  status: z.enum(["pending", "accepted", "dismissed", "superseded"]),
  noteId: z.string().optional(),
  groupId: z.string().optional(),
  targetGroupId: z.string().optional(),
  proposedParentId: z.string().nullable().optional(),
  proposedName: z.string().optional(),
  proposedDescription: z.string().optional(),
  proposedTags: z.array(z.string()).optional(),
  proposedRelatedNoteIds: z.array(z.string()).optional(),
  confidence: z.number(),
  reason: z.string(),
  source: z.enum(["semantic", "llm-label"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ISemanticSuggestion = z.infer<typeof semanticSuggestionSchema>;
