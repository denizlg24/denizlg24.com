import mongoose from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { serializeGroup } from "@/lib/note-route-utils";
import { requireAdmin } from "@/lib/require-admin";
import { type ILeanNoteGroup, NoteGroup } from "@/models/NoteGroup";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    await connectDB();
    const groups = await NoteGroup.find()
      .sort({ name: 1 })
      .lean<ILeanNoteGroup[]>()
      .exec();
    return NextResponse.json(
      { groups: groups.map(serializeGroup) },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error fetching note groups:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    if (!body.name || typeof body.name !== "string") {
      return NextResponse.json({ error: "name required" }, { status: 400 });
    }

    await connectDB();

    const parentId =
      typeof body.parentId === "string" &&
      mongoose.Types.ObjectId.isValid(body.parentId)
        ? new mongoose.Types.ObjectId(body.parentId)
        : null;

    const group = await NoteGroup.create({
      name: body.name,
      description: body.description,
      color: body.color,
      parentId,
      autoCreated: false,
      kind: "manual",
      source: "user",
      lockedByUser: true,
    });

    return NextResponse.json(
      {
        group: serializeGroup({
          ...group.toObject(),
          _id: group._id.toString(),
          parentId: group.parentId ? String(group.parentId) : null,
        }),
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error creating note group:", error);
    return NextResponse.json(
      { error: (error as Error).message || "Failed" },
      { status: 500 },
    );
  }
}
