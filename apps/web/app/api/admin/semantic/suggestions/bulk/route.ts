import mongoose from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { isSuggestionType, objectIdOrNull } from "@/lib/semantic-route-utils";
import { KnowledgeSemanticSuggestion } from "@/models/KnowledgeSemanticSuggestion";

function normalizeTags(value: unknown) {
  return Array.isArray(value)
    ? value.filter((tag): tag is string => typeof tag === "string").slice(0, 5)
    : [];
}

function normalizeNoteIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (id): id is string =>
        typeof id === "string" && mongoose.Types.ObjectId.isValid(id),
    )
    .map((id) => new mongoose.Types.ObjectId(id));
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const runId = objectIdOrNull(body.runId);
    const suggestions = Array.isArray(body.suggestions) ? body.suggestions : [];

    if (!runId) {
      return NextResponse.json({ error: "runId required" }, { status: 400 });
    }

    await connectDB();

    let superseded = 0;
    let inserted = 0;

    for (const suggestion of suggestions) {
      if (!isSuggestionType(suggestion.type)) continue;

      const noteId = objectIdOrNull(suggestion.noteId);
      const groupId = objectIdOrNull(suggestion.groupId);
      const targetGroupId = objectIdOrNull(suggestion.targetGroupId);
      const proposedParentId =
        suggestion.proposedParentId === null
          ? null
          : objectIdOrNull(suggestion.proposedParentId);

      const supersedeFilter: Record<string, unknown> = {
        status: "pending",
        type: suggestion.type,
      };
      if (noteId) supersedeFilter.noteId = noteId;
      if (groupId) supersedeFilter.groupId = groupId;
      if (targetGroupId) supersedeFilter.targetGroupId = targetGroupId;

      if (noteId || groupId || targetGroupId) {
        const result = await KnowledgeSemanticSuggestion.updateMany(
          supersedeFilter,
          { $set: { status: "superseded", decidedAt: new Date() } },
        ).exec();
        superseded += result.modifiedCount;
      }

      await KnowledgeSemanticSuggestion.create({
        runId,
        type: suggestion.type,
        status: "pending",
        noteId: noteId ?? undefined,
        groupId: groupId ?? undefined,
        targetGroupId: targetGroupId ?? undefined,
        proposedParentId,
        proposedName:
          typeof suggestion.proposedName === "string"
            ? suggestion.proposedName
            : undefined,
        proposedDescription:
          typeof suggestion.proposedDescription === "string"
            ? suggestion.proposedDescription
            : undefined,
        proposedTags: normalizeTags(suggestion.proposedTags),
        proposedRelatedNoteIds: normalizeNoteIds(
          suggestion.proposedRelatedNoteIds,
        ),
        confidence:
          typeof suggestion.confidence === "number"
            ? Math.max(0, Math.min(1, suggestion.confidence))
            : 0.5,
        reason:
          typeof suggestion.reason === "string"
            ? suggestion.reason
            : "Semantic suggestion",
        source: suggestion.source === "llm-label" ? "llm-label" : "semantic",
      });
      inserted += 1;
    }

    return NextResponse.json({ inserted, superseded });
  } catch (error) {
    console.error("Error uploading semantic suggestions:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
