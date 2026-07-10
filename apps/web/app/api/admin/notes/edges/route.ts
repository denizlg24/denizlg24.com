import mongoose from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { serializeEdge } from "@/lib/note-route-utils";
import { requireAdmin } from "@/lib/require-admin";
import { Note } from "@/models/Note";
import { type ILeanNoteEdge, NoteEdge } from "@/models/NoteEdge";

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const from = typeof body.from === "string" ? body.from : "";
    const to = typeof body.to === "string" ? body.to : "";
    const reason =
      typeof body.reason === "string" && body.reason.trim().length > 0
        ? body.reason.trim()
        : undefined;

    if (
      !mongoose.Types.ObjectId.isValid(from) ||
      !mongoose.Types.ObjectId.isValid(to) ||
      from === to
    ) {
      return NextResponse.json(
        { error: "from and to must be two distinct note ids" },
        { status: 400 },
      );
    }

    await connectDB();

    const [fromNote, toNote] = await Promise.all([
      Note.exists({ _id: from }),
      Note.exists({ _id: to }),
    ]);
    if (!fromNote || !toNote) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    const existing = await NoteEdge.findOne({
      $or: [
        { from, to },
        { from: to, to: from },
      ],
    })
      .lean<ILeanNoteEdge>()
      .exec();
    if (existing) {
      return NextResponse.json({ edge: serializeEdge(existing) });
    }

    const created = await NoteEdge.create({
      from,
      to,
      strength: 1,
      reason,
      source: "manual",
    });
    const edge = await NoteEdge.findById(created._id)
      .lean<ILeanNoteEdge>()
      .exec();
    if (!edge) {
      throw new Error("Created edge could not be reloaded");
    }

    return NextResponse.json({ edge: serializeEdge(edge) }, { status: 201 });
  } catch (error) {
    console.error("Error creating note edge:", error);
    return NextResponse.json(
      { error: "Failed to create note edge" },
      { status: 500 },
    );
  }
}
