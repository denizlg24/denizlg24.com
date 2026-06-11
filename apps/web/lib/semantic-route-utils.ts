import mongoose from "mongoose";
import type {
  ILeanKnowledgeSemanticRun,
  SemanticRunParameters,
} from "@/models/KnowledgeSemanticRun";
import type {
  ILeanKnowledgeSemanticSuggestion,
  SemanticSuggestionStatus,
  SemanticSuggestionType,
} from "@/models/KnowledgeSemanticSuggestion";

export function serializeSemanticRun(run: ILeanKnowledgeSemanticRun) {
  return {
    ...run,
    _id: String(run._id),
  };
}

export function serializeSemanticSuggestion(
  suggestion: ILeanKnowledgeSemanticSuggestion,
) {
  return {
    ...suggestion,
    _id: String(suggestion._id),
    runId: String(suggestion.runId),
    noteId: suggestion.noteId ? String(suggestion.noteId) : undefined,
    groupId: suggestion.groupId ? String(suggestion.groupId) : undefined,
    targetGroupId: suggestion.targetGroupId
      ? String(suggestion.targetGroupId)
      : undefined,
    proposedParentId:
      suggestion.proposedParentId === null
        ? null
        : suggestion.proposedParentId
          ? String(suggestion.proposedParentId)
          : undefined,
    proposedRelatedNoteIds: (suggestion.proposedRelatedNoteIds ?? []).map(
      String,
    ),
  };
}

export function objectIdOrNull(value: unknown) {
  if (typeof value !== "string" || !mongoose.Types.ObjectId.isValid(value)) {
    return null;
  }

  return new mongoose.Types.ObjectId(value);
}

export function pickNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function normalizeParameters(
  value: unknown,
  defaults: SemanticRunParameters,
): SemanticRunParameters {
  const input =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};

  return {
    topK: pickNumber(input.topK, defaults.topK),
    minSimilarity: pickNumber(input.minSimilarity, defaults.minSimilarity),
    strongSimilarity: pickNumber(
      input.strongSimilarity,
      defaults.strongSimilarity,
    ),
    clusterMinSize: pickNumber(input.clusterMinSize, defaults.clusterMinSize),
    maxGroupsPerNote: pickNumber(
      input.maxGroupsPerNote,
      defaults.maxGroupsPerNote,
    ),
  };
}

export function isSuggestionStatus(
  value: unknown,
): value is SemanticSuggestionStatus {
  return (
    value === "pending" ||
    value === "accepted" ||
    value === "dismissed" ||
    value === "superseded"
  );
}

export function isSuggestionType(
  value: unknown,
): value is SemanticSuggestionType {
  return (
    value === "join-group" ||
    value === "create-group" ||
    value === "rename-group" ||
    value === "move-group" ||
    value === "add-tags" ||
    value === "add-edge" ||
    value === "archive-edge" ||
    value === "cluster-label"
  );
}
