import { connectDB } from "@/lib/mongodb";
import { runSemanticKeywordSync } from "@/lib/semantic-llm";
import {
  isSuggestionStatus,
  isSuggestionType,
  serializeSemanticSuggestion,
} from "@/lib/semantic-route-utils";
import {
  acceptSemanticSuggestion,
  dismissSemanticSuggestion,
  SuggestionNotPendingError,
} from "@/lib/semantic-suggestions";
import { KnowledgeSemanticRun } from "@/models/KnowledgeSemanticRun";
import {
  type ILeanKnowledgeSemanticSuggestion,
  KnowledgeSemanticSuggestion,
} from "@/models/KnowledgeSemanticSuggestion";
import type { ToolDefinition } from "./types";

/**
 * The semantic layer proposes structure over notes — groups to create, notes to
 * file, tags and edges to add — and every proposal lands as a suggestion for
 * the owner to accept or dismiss. These tools work that queue.
 *
 * The admin route caps its listing at 500 because it renders a scrollable list.
 * A model has no use for 500 proposals at once, so the cap here is far lower
 * and confidence-ordered: the ones worth acting on are at the top.
 */

const MAX_SUGGESTIONS = 40;

const SUGGESTION_TYPES = [
  "join-group",
  "create-group",
  "rename-group",
  "cluster-label",
  "move-group",
  "add-tags",
  "add-edge",
] as const;

export const semanticTools: ToolDefinition[] = [
  {
    schema: {
      name: "list_semantic_suggestions",
      description:
        "Structural proposals over the note graph, highest confidence first. Accepting one applies the edit it describes.",
      input_schema: {
        type: "object",
        properties: {
          status: {
            type: "string",
            description: "Defaults to pending.",
            enum: ["pending", "accepted", "dismissed"],
          },
          type: {
            type: "string",
            description: "Only proposals of this kind.",
            enum: [...SUGGESTION_TYPES],
          },
          limit: {
            type: "number",
            description: "Max to return, 1-40 (default 20).",
            minimum: 1,
            maximum: 40,
          },
        },
      },
    },
    isWrite: false,
    category: "semantic",
    execute: async (input) => {
      await connectDB();
      const status = (input.status as string | undefined) ?? "pending";
      const filter: Record<string, unknown> = {};
      if (isSuggestionStatus(status)) filter.status = status;
      if (isSuggestionType(input.type)) filter.type = input.type;
      const limit = Math.min(
        Math.max(Number(input.limit ?? 20), 1),
        MAX_SUGGESTIONS,
      );
      const [suggestions, total] = await Promise.all([
        KnowledgeSemanticSuggestion.find(filter)
          .sort({ confidence: -1, createdAt: -1 })
          .limit(limit)
          .lean<ILeanKnowledgeSemanticSuggestion[]>()
          .exec(),
        KnowledgeSemanticSuggestion.countDocuments(filter),
      ]);
      return {
        suggestions: suggestions.map(serializeSemanticSuggestion),
        total,
        truncated: total > suggestions.length,
      };
    },
  },
  {
    schema: {
      name: "accept_semantic_suggestion",
      description:
        "Apply a semantic proposal and mark it accepted. What it changes depends on the type: filing a note into a group, creating or renaming a group, adding tags, or linking two notes. A group the owner has pinned is never renamed or moved, even by an accepted proposal.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Suggestion ID." },
        },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "semantic",
    execute: async (input) => {
      try {
        const result = await acceptSemanticSuggestion(String(input.id ?? ""));
        if (!result) throw new Error("Suggestion not found");
        const { suggestion, ...applied } = result;
        return {
          suggestion: suggestion
            ? serializeSemanticSuggestion(suggestion)
            : undefined,
          ...applied,
        };
      } catch (error) {
        if (error instanceof SuggestionNotPendingError) {
          throw new Error("Suggestion has already been decided");
        }
        throw error;
      }
    },
  },
  {
    schema: {
      name: "dismiss_semantic_suggestion",
      description:
        "Reject a semantic proposal without applying it. The suggestion stays on record as dismissed.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Suggestion ID." },
        },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "semantic",
    execute: async (input) => {
      const suggestion = await dismissSemanticSuggestion(
        String(input.id ?? ""),
      );
      if (!suggestion) throw new Error("Suggestion not found");
      return serializeSemanticSuggestion(suggestion);
    },
  },
  {
    schema: {
      name: "run_semantic_sync",
      description:
        "Re-derive keywords and structural proposals across notes. This costs model calls proportional to how many notes it processes, so prefer missingOnly unless a full re-derivation is actually wanted.",
      input_schema: {
        type: "object",
        properties: {
          missingOnly: {
            type: "boolean",
            description: "Only notes with no keywords yet.",
          },
          force: {
            type: "boolean",
            description:
              "Re-process notes that are already current, up to 10,000. Expensive.",
          },
          limit: {
            type: "number",
            description: "Cap on notes processed.",
            minimum: 1,
            maximum: 10000,
          },
        },
      },
    },
    isWrite: true,
    category: "semantic",
    execute: async (input) =>
      runSemanticKeywordSync({
        force: input.force === true,
        missingOnly: input.missingOnly === true,
        limit: input.limit as number | undefined,
      }),
  },
  {
    schema: {
      name: "list_semantic_runs",
      description:
        "Recent semantic runs with their status and the model each used. Use it to check whether a sync finished before reading its suggestions.",
      input_schema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Max runs, 1-20 (default 10).",
            minimum: 1,
            maximum: 20,
          },
        },
      },
    },
    isWrite: false,
    category: "semantic",
    execute: async (input) => {
      await connectDB();
      const limit = Math.min(Math.max(Number(input.limit ?? 10), 1), 20);
      const runs = await KnowledgeSemanticRun.find()
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean()
        .exec();
      return {
        runs: runs.map((run) => ({
          _id: String(run._id),
          model: run.model,
          status: run.status,
          initiatedBy: run.initiatedBy,
          createdAt: run.createdAt,
          completedAt: run.completedAt,
        })),
      };
    },
  },
];
