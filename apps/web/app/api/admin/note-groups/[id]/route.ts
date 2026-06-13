import mongoose from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import {
  buildAncestorMap,
  pruneRedundantAncestors,
} from "@/lib/note-group-hierarchy";
import { serializeGroup } from "@/lib/note-route-utils";
import { requireAdmin } from "@/lib/require-admin";
import { KnowledgeSemanticSuggestion } from "@/models/KnowledgeSemanticSuggestion";
import { type ILeanNote, Note } from "@/models/Note";
import { type ILeanNoteGroup, NoteGroup } from "@/models/NoteGroup";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    const body = await request.json();

    await connectDB();

    const update: Record<string, unknown> = {};
    if (typeof body.name === "string") update.name = body.name;
    if (typeof body.description === "string")
      update.description = body.description;
    if (typeof body.color === "string") update.color = body.color;
    if ("parentId" in body) {
      if (body.parentId === null || body.parentId === "") {
        update.parentId = null;
      } else if (
        typeof body.parentId === "string" &&
        mongoose.Types.ObjectId.isValid(body.parentId) &&
        body.parentId !== id
      ) {
        update.parentId = new mongoose.Types.ObjectId(body.parentId);
      }
    }
    if (Object.keys(update).length > 0) {
      update.lockedByUser = true;
      update.source = "user";
      update.kind = "manual";
    }

    const group = await NoteGroup.findByIdAndUpdate(id, update, {
      returnDocument: "after",
      runValidators: true,
    })
      .lean<ILeanNoteGroup>()
      .exec();

    if (!group) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if ("parentId" in update) {
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
        groups.map((candidate) => ({
          _id: String(candidate._id),
          parentId: candidate.parentId ? String(candidate.parentId) : null,
        })),
      );

      const notes = await Note.find({
        $expr: { $gt: [{ $size: { $ifNull: ["$groupIds", []] } }, 1] },
      })
        .select("_id groupIds")
        .lean<ILeanNote[]>()
        .exec();

      const operations = notes
        .map((note) => {
          const current = (note.groupIds ?? []).map(String);
          const pruned = pruneRedundantAncestors(current, ancestorMap);
          if (pruned.length === current.length) return null;

          return {
            updateOne: {
              filter: { _id: new mongoose.Types.ObjectId(String(note._id)) },
              update: {
                $set: {
                  groupIds: pruned.map(
                    (groupId) => new mongoose.Types.ObjectId(groupId),
                  ),
                },
              },
            },
          };
        })
        .filter(
          (
            operation,
          ): operation is {
            updateOne: {
              filter: { _id: mongoose.Types.ObjectId };
              update: { $set: { groupIds: mongoose.Types.ObjectId[] } };
            };
          } => Boolean(operation),
        );

      if (operations.length > 0) {
        await Note.bulkWrite(operations);
      }
      await Note.updateMany(
        { groupIds: new mongoose.Types.ObjectId(id) },
        { $set: { semanticStatus: "stale" } },
      ).exec();
    }

    return NextResponse.json({ group: serializeGroup(group) }, { status: 200 });
  } catch (error) {
    console.error("Error updating note group:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    await connectDB();

    const group = await NoteGroup.findByIdAndDelete(id).exec();
    if (!group) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const objectId = new mongoose.Types.ObjectId(id);

    await Promise.all([
      Note.updateMany(
        { groupIds: objectId },
        { $pull: { groupIds: objectId } },
      ).exec(),
      NoteGroup.updateMany(
        { parentId: objectId },
        { $set: { parentId: null } },
      ).exec(),
      KnowledgeSemanticSuggestion.updateMany(
        {
          status: "pending",
          $or: [
            { groupId: objectId },
            { targetGroupId: objectId },
            { proposedParentId: objectId },
          ],
        },
        { $set: { status: "superseded", decidedAt: new Date() } },
      ).exec(),
    ]);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error deleting note group:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
