import type { QueryFilter } from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { serializeGroup, serializeNote } from "@/lib/note-route-utils";
import { requireAdmin } from "@/lib/require-admin";
import { type ILeanNote, type INote, Note } from "@/models/Note";
import { type ILeanNoteGroup, NoteGroup } from "@/models/NoteGroup";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    await connectDB();

    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get("status") ?? "all";
    const limit = Math.min(Number(searchParams.get("limit") ?? 5000), 10_000);
    const filter: QueryFilter<INote> =
      status === "pending" || status === "stale"
        ? { semanticStatus: status }
        : {};

    const [notes, groups] = await Promise.all([
      Note.find(filter)
        .sort({ updatedAt: -1 })
        .limit(limit)
        .lean<ILeanNote[]>()
        .exec(),
      NoteGroup.find().sort({ name: 1 }).lean<ILeanNoteGroup[]>().exec(),
    ]);

    return NextResponse.json(
      {
        notes: notes.map(serializeNote),
        groups: groups.map(serializeGroup),
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error fetching semantic notes:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
