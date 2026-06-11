import mongoose from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import {
  buildAncestorMap,
  pruneRedundantAncestors,
} from "@/lib/note-group-hierarchy";
import { serializePersonGroup } from "@/lib/people-route-utils";
import { requireAdmin } from "@/lib/require-admin";
import { type ILeanPerson, Person } from "@/models/Person";
import { type ILeanPersonGroup, PersonGroup } from "@/models/PersonGroup";

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

    const group = await PersonGroup.findByIdAndUpdate(id, update, {
      new: true,
      runValidators: true,
    })
      .lean<ILeanPersonGroup>()
      .exec();

    if (!group)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    if ("parentId" in update) {
      const groups = await PersonGroup.find()
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
      const people = await Person.find({
        $expr: { $gt: [{ $size: { $ifNull: ["$groupIds", []] } }, 1] },
      })
        .select("_id groupIds")
        .lean<ILeanPerson[]>()
        .exec();
      const operations = people
        .map((person) => {
          const current = (person.groupIds ?? []).map(String);
          const pruned = pruneRedundantAncestors(current, ancestorMap);
          if (pruned.length === current.length) return null;
          return {
            updateOne: {
              filter: { _id: new mongoose.Types.ObjectId(String(person._id)) },
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
        .filter((operation): operation is NonNullable<typeof operation> =>
          Boolean(operation),
        );
      if (operations.length > 0) await Person.bulkWrite(operations);
    }

    return NextResponse.json({ group: serializePersonGroup(group) });
  } catch (error) {
    console.error("Error updating person group:", error);
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

    const group = await PersonGroup.findByIdAndDelete(id).exec();
    if (!group)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    const objectId = new mongoose.Types.ObjectId(id);
    await Promise.all([
      Person.updateMany(
        { groupIds: objectId },
        { $pull: { groupIds: objectId } },
      ).exec(),
      PersonGroup.updateMany(
        { parentId: objectId },
        { $set: { parentId: null } },
      ).exec(),
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting person group:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
