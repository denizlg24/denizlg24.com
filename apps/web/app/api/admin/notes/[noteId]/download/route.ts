import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { Note } from "@/models/Note";

export const GET = async (
  request: NextRequest,
  { params }: { params: Promise<{ noteId: string }> },
) => {
  const { noteId } = await params;
  if (!noteId || typeof noteId !== "string") {
    return NextResponse.json({ error: "Invalid note ID" }, { status: 400 });
  }
  try {
    const authError = await requireAdmin(request);
    if (authError) return authError;
    await connectDB();
    const note = await Note.findById(noteId);
    if (!note) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }
    const fileName = `${note.title}.md`;
    const fileContent = note.content;
    const headers = new Headers();
    headers.append("Content-Disposition", `attachment; filename="${fileName}"`);
    headers.append("Content-Type", "text/markdown");
    return new NextResponse(fileContent, { headers });
  } catch (error) {
    console.error("Error downloading note:", error);
    return NextResponse.json(
      { error: "Failed to download note" },
      { status: 500 },
    );
  }
};
