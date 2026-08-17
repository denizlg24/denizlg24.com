import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import {
  pruneGroupIds,
  serializeGroup,
  serializeNote,
} from "@/lib/note-route-utils";
import {
  type ILeanKnowledgeSemanticSuggestion,
  KnowledgeSemanticSuggestion,
} from "@/models/KnowledgeSemanticSuggestion";
import { type ILeanNote, Note } from "@/models/Note";
import { NoteEdge } from "@/models/NoteEdge";
import { type ILeanNoteGroup, NoteGroup } from "@/models/NoteGroup";

/**
 * Applying a semantic suggestion.
 *
 * Each suggestion type edits a different thing — a note's groups, a group's
 * name, an edge — and accepting one is the only place that mapping lives. The
 * route and the agent tools both go through here so a suggestion accepted by
 * either has the same effect.
 */

export class SuggestionNotPendingError extends Error {
  constructor() {
    super("Suggestion is not pending");
    this.name = "SuggestionNotPendingError";
  }
}

async function applySuggestion(
  suggestion: ILeanKnowledgeSemanticSuggestion,
): Promise<{ note?: unknown; group?: unknown }> {
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
        { returnDocument: "after" },
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
      // `lockedByUser` is respected here rather than checked by the caller: a
      // group the owner has pinned must not be renamed by an accepted machine
      // suggestion, however it was accepted.
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
        { returnDocument: "after" },
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
        { returnDocument: "after" },
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
        { returnDocument: "after" },
      )
        .lean<ILeanNote>()
        .exec();
      return { note: updated ? serializeNote(updated) : undefined };
    }
    case "add-edge": {
      if (!suggestion.noteId || !suggestion.proposedRelatedNoteIds?.[0]) {
        return {};
      }
      const relatedId = suggestion.proposedRelatedNoteIds[0];
      // Ordered by id so the pair has one canonical representation and an
      // upsert cannot create both directions as separate edges.
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

export async function acceptSemanticSuggestion(id: string) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  await connectDB();
  const suggestion = await KnowledgeSemanticSuggestion.findById(id)
    .lean<ILeanKnowledgeSemanticSuggestion>()
    .exec();
  if (!suggestion) return null;
  if (suggestion.status !== "pending") throw new SuggestionNotPendingError();

  const result = await applySuggestion(suggestion);
  const updated = await KnowledgeSemanticSuggestion.findByIdAndUpdate(
    id,
    { $set: { status: "accepted", decidedAt: new Date() } },
    { returnDocument: "after" },
  )
    .lean<ILeanKnowledgeSemanticSuggestion>()
    .exec();
  return { suggestion: updated, ...result };
}

export async function dismissSemanticSuggestion(id: string) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  await connectDB();
  return KnowledgeSemanticSuggestion.findByIdAndUpdate(
    id,
    { $set: { status: "dismissed", decidedAt: new Date() } },
    { returnDocument: "after" },
  )
    .lean<ILeanKnowledgeSemanticSuggestion>()
    .exec();
}
