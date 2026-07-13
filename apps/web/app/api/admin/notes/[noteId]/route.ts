import { type NextRequest, NextResponse } from "next/server";
import { observeDomainRecordSafely } from "@/lib/agent-memory/domain-evidence";
import { connectDB } from "@/lib/mongodb";
import { pruneGroupIds, serializeNote } from "@/lib/note-route-utils";
import { requireAdmin } from "@/lib/require-admin";
import { KnowledgeSemanticSuggestion } from "@/models/KnowledgeSemanticSuggestion";
import { type ILeanNote, Note } from "@/models/Note";
import { NoteEdge } from "@/models/NoteEdge";
import { NoteEmbedding } from "@/models/NoteEmbedding";

async function updateNote(request: NextRequest, noteId: string) {
  const body = await request.json();
  const update: Record<string, unknown> = {};
  const unset: Record<string, unknown> = {};
  let semanticAffectingChange = false;

  if (typeof body.title === "string") {
    update.title = body.title.trim();
    semanticAffectingChange = true;
  }
  if (typeof body.content === "string") {
    update.content = body.content;
    semanticAffectingChange = true;
  }
  if (typeof body.url === "string") {
    const trimmed = body.url.trim();
    if (trimmed.length === 0) unset.url = "";
    else update.url = trimmed;
    semanticAffectingChange = true;
  }
  if (typeof body.description === "string") {
    update.description = body.description;
    semanticAffectingChange = true;
  }
  if (typeof body.siteName === "string") {
    update.siteName = body.siteName;
    semanticAffectingChange = true;
  }
  if (typeof body.favicon === "string") update.favicon = body.favicon;
  if (typeof body.image === "string") update.image = body.image;
  if (typeof body.class === "string") {
    const trimmed = body.class.trim();
    if (trimmed.length === 0) unset.class = "";
    else update.class = trimmed;
    semanticAffectingChange = true;
  }
  if (Array.isArray(body.tags)) {
    update.tags = body.tags.filter(
      (tag: unknown): tag is string => typeof tag === "string",
    );
    semanticAffectingChange = true;
  }
  if (Array.isArray(body.groupIds)) {
    const prunedGroupIds = await pruneGroupIds(body.groupIds);
    update.groupIds = prunedGroupIds;
    update.manualGroupIds = prunedGroupIds;
    semanticAffectingChange = true;
  }
  if (body.status === "open" || body.status === "archived") {
    update.status = body.status;
  }
  if (body.publishedDate === null) {
    unset.publishedDate = "";
  } else if (typeof body.publishedDate === "string") {
    const date = new Date(body.publishedDate);
    if (!Number.isNaN(date.getTime())) {
      update.publishedDate = date;
    }
  }
  if (semanticAffectingChange) {
    update.semanticStatus = "stale";
  }

  const mutation: Record<string, unknown> = {};
  if (Object.keys(update).length > 0) mutation.$set = update;
  if (Object.keys(unset).length > 0) mutation.$unset = unset;

  const note = await Note.findByIdAndUpdate(noteId, mutation, {
    returnDocument: "after",
    runValidators: true,
  })
    .lean<ILeanNote>()
    .exec();

  if (!note) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await observeDomainRecordSafely("note", note);

  return NextResponse.json({ note: serializeNote(note) }, { status: 200 });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ noteId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { noteId } = await params;
    await connectDB();
    const note = await Note.findById(noteId).lean<ILeanNote>().exec();
    if (!note) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ note: serializeNote(note) }, { status: 200 });
  } catch (error) {
    console.error("Error fetching note:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ noteId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { noteId } = await params;
    await connectDB();
    return await updateNote(request, noteId);
  } catch (error) {
    console.error("Error updating note:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ noteId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { noteId } = await params;
    await connectDB();
    return await updateNote(request, noteId);
  } catch (error) {
    console.error("Error updating note:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ noteId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { noteId } = await params;
    await connectDB();

    const note = await Note.findByIdAndDelete(noteId).lean<ILeanNote>().exec();
    if (!note) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await NoteEdge.deleteMany({
      $or: [{ from: note._id }, { to: note._id }],
    }).exec();
    await Promise.all([
      NoteEmbedding.deleteMany({ noteId: note._id }).exec(),
      KnowledgeSemanticSuggestion.updateMany(
        { noteId: note._id, status: "pending" },
        { $set: { status: "superseded", decidedAt: new Date() } },
      ).exec(),
    ]);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error deleting note:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
