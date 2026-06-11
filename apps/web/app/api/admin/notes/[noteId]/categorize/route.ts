import { type NextRequest, NextResponse } from "next/server";
import { resolveIncomingCategorization } from "@/lib/apply-note-categorization";
import { connectDB } from "@/lib/mongodb";
import { serializeGroup, serializeNote } from "@/lib/note-route-utils";
import { requireAdmin } from "@/lib/require-admin";
import { type ILeanNote, Note } from "@/models/Note";
import { type ILeanNoteGroup, NoteGroup } from "@/models/NoteGroup";

function pickString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ noteId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { noteId } = await params;
    const body = await request.json().catch(() => ({}));

    await connectDB();

    const note = await Note.findById(noteId).lean<ILeanNote>().exec();
    if (!note) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const title = pickString(body.title) ?? note.title;
    const content =
      typeof body.content === "string" ? body.content : (note.content ?? "");
    const description =
      typeof body.description === "string"
        ? body.description
        : note.description;
    const siteName = pickString(body.siteName) ?? note.siteName;
    const url = pickString(body.url) ?? note.url;

    const resolved = await resolveIncomingCategorization({
      input: {
        title,
        content,
        description,
        siteName,
        url,
      },
      manualTags: note.tags ?? [],
      manualGroupIds: (note.groupIds ?? []).map(String),
    });

    const updatedNote = await Note.findByIdAndUpdate(
      noteId,
      {
        $set: {
          tags: resolved.tags,
          groupIds: resolved.groupIds,
        },
      },
      {
        new: true,
        runValidators: true,
      },
    )
      .lean<ILeanNote>()
      .exec();

    if (!updatedNote) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const groups = await NoteGroup.find()
      .sort({ name: 1 })
      .lean<ILeanNoteGroup[]>()
      .exec();

    return NextResponse.json(
      {
        note: serializeNote(updatedNote),
        groups: groups.map(serializeGroup),
        edges: [],
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error categorizing note:", error);
    return NextResponse.json(
      { error: "Failed to categorize note" },
      { status: 500 },
    );
  }
}
