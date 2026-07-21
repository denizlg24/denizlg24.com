import mongoose from "mongoose";
import {
  buildAncestorMap,
  pruneRedundantAncestors,
} from "@/lib/note-group-hierarchy";
import type { ILeanNote } from "@/models/Note";
import type { ILeanNoteEdge } from "@/models/NoteEdge";
import type { ILeanNoteGroup } from "@/models/NoteGroup";
import { NoteGroup } from "@/models/NoteGroup";

export function serializeNote(note: ILeanNote) {
  return {
    ...note,
    _id: String(note._id),
    paperId: note.paperId ? String(note.paperId) : undefined,
    groupIds: (note.groupIds ?? []).map(String),
    manualGroupIds: (note.manualGroupIds ?? []).map(String),
  };
}

export function serializeGroup(group: ILeanNoteGroup) {
  return {
    ...group,
    _id: String(group._id),
    parentId: group.parentId ? String(group.parentId) : null,
    semanticRunId: group.semanticRunId
      ? String(group.semanticRunId)
      : undefined,
  };
}

export function serializeEdge(edge: ILeanNoteEdge) {
  return {
    ...edge,
    _id: String(edge._id),
    from: String(edge.from),
    to: String(edge.to),
    runId: edge.runId ? String(edge.runId) : undefined,
  };
}

export async function pruneGroupIds(groupIds: string[]) {
  const deduped = [
    ...new Set(
      groupIds.filter(
        (groupId) =>
          typeof groupId === "string" &&
          mongoose.Types.ObjectId.isValid(groupId),
      ),
    ),
  ];

  if (deduped.length < 2) {
    return deduped.map((groupId) => new mongoose.Types.ObjectId(groupId));
  }

  const groups = await NoteGroup.find()
    .select("_id parentId")
    .lean<
      Array<{
        _id: mongoose.Types.ObjectId;
        parentId?: mongoose.Types.ObjectId | null;
      }>
    >()
    .exec();

  const ancestorMap = buildAncestorMap(
    groups.map((group) => ({
      _id: String(group._id),
      parentId: group.parentId ? String(group.parentId) : null,
    })),
  );

  return pruneRedundantAncestors(deduped, ancestorMap).map(
    (groupId) => new mongoose.Types.ObjectId(groupId),
  );
}
