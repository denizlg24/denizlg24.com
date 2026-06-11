import mongoose from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import {
  pruneGroupIds,
  serializeGroup,
  serializeNote,
} from "@/lib/note-route-utils";
import { requireAdmin } from "@/lib/require-admin";
import { serializeSemanticSuggestion } from "@/lib/semantic-route-utils";
import {
  type ILeanKnowledgeSemanticSuggestion,
  KnowledgeSemanticSuggestion,
} from "@/models/KnowledgeSemanticSuggestion";
import { type ILeanNote, Note } from "@/models/Note";
import { NoteEdge } from "@/models/NoteEdge";
import { type ILeanNoteGroup, NoteGroup } from "@/models/NoteGroup";

async function acceptSuggestion(suggestion: ILeanKnowledgeSemanticSuggestion) {
  switch (suggestion.type) {
    case "join-group": {
      if (!suggestion.noteId || !suggestion.targetGroupId) return {};
      const note = await Note.findById(suggestion.noteId)
        .lean<ILeanNote>()
        .exec();
      if (!note) return {};
      const groupIds = await pruneGroupIds([
        ...(note.groupIds ?? []).map(String),
        String(suggestion.targetGroupId),
      ]);
      const updated = await Note.findByIdAndUpdate(
        suggestion.noteId,
        { $set: { groupIds, semanticStatus: "stale" } },
        { new: true },
      )
        .lean<ILeanNote>()
        .exec();
      return { note: updated ? serializeNote(updated) : undefined };
    }
    case "create-group": {
      if (!suggestion.proposedName) return {};
      const group = await NoteGroup.create({
        name: suggestion.proposedName,
        description: suggestion.proposedDescription,
        parentId: suggestion.proposedParentId ?? null,
        autoCreated: true,
        kind: "generated",
        source: suggestion.source === "llm-label" ? "llm" : "semantic",
        lockedByUser: false,
        semanticRunId: suggestion.runId,
        confidence: suggestion.confidence,
      });
      return {
        group: serializeGroup({
          ...group.toObject(),
          _id: String(group._id),
          parentId: group.parentId ? String(group.parentId) : null,
        }),
      };
    }
    case "rename-group":
    case "cluster-label": {
      if (!suggestion.groupId || !suggestion.proposedName) return {};
      const group = await NoteGroup.findOneAndUpdate(
        { _id: suggestion.groupId, lockedByUser: { $ne: true } },
        {
          $set: {
            name: suggestion.proposedName,
            description: suggestion.proposedDescription,
            source: suggestion.source === "llm-label" ? "llm" : "semantic",
            confidence: suggestion.confidence,
          },
        },
        { new: true },
      )
        .lean<ILeanNoteGroup>()
        .exec();
      return { group: group ? serializeGroup(group) : undefined };
    }
    case "move-group": {
      if (!suggestion.groupId) return {};
      const group = await NoteGroup.findOneAndUpdate(
        { _id: suggestion.groupId, lockedByUser: { $ne: true } },
        { $set: { parentId: suggestion.proposedParentId ?? null } },
        { new: true },
      )
        .lean<ILeanNoteGroup>()
        .exec();
      return { group: group ? serializeGroup(group) : undefined };
    }
    case "add-tags": {
      if (!suggestion.noteId || !suggestion.proposedTags?.length) return {};
      const note = await Note.findById(suggestion.noteId)
        .lean<ILeanNote>()
        .exec();
      if (!note) return {};
      const tags = [
        ...new Set([...(note.tags ?? []), ...suggestion.proposedTags]),
      ];
      const updated = await Note.findByIdAndUpdate(
        suggestion.noteId,
        { $set: { tags, semanticStatus: "stale" } },
        { new: true },
      )
        .lean<ILeanNote>()
        .exec();
      return { note: updated ? serializeNote(updated) : undefined };
    }
    case "add-edge": {
      if (!suggestion.noteId || !suggestion.proposedRelatedNoteIds?.[0])
        return {};
      const relatedId = suggestion.proposedRelatedNoteIds[0];
      const [from, to] =
        String(suggestion.noteId) < String(relatedId)
          ? [suggestion.noteId, relatedId]
          : [relatedId, suggestion.noteId];
      await NoteEdge.updateOne(
        { from, to },
        {
          $set: {
            from,
            to,
            strength: suggestion.confidence,
            reason: suggestion.reason,
            source: "semantic",
            runId: suggestion.runId,
          },
        },
        { upsert: true },
      ).exec();
      return {};
    }
    default:
      return {};
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    await connectDB();
    const suggestion = await KnowledgeSemanticSuggestion.findById(id)
      .lean<ILeanKnowledgeSemanticSuggestion>()
      .exec();

    if (!suggestion) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (suggestion.status !== "pending") {
      return NextResponse.json(
        { error: "Suggestion is not pending" },
        { status: 409 },
      );
    }

    const result = await acceptSuggestion(suggestion);
    const updated = await KnowledgeSemanticSuggestion.findByIdAndUpdate(
      id,
      { $set: { status: "accepted", decidedAt: new Date() } },
      { new: true },
    )
      .lean<ILeanKnowledgeSemanticSuggestion>()
      .exec();

    return NextResponse.json({
      suggestion: updated ? serializeSemanticSuggestion(updated) : undefined,
      ...result,
    });
  } catch (error) {
    console.error("Error accepting semantic suggestion:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
