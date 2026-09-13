import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { Note } from "@/models/Note";

const MAX_LIMIT = 50;

/** Mongo text search over title and content, ranked by score. */
export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const search = request.nextUrl.searchParams;
  const q = search.get("q")?.trim() ?? "";
  if (!q) {
    return NextResponse.json({ error: "q is required" }, { status: 400 });
  }
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(search.get("limit") ?? 10) || 10),
  );

  try {
    await connectDB();
    const notes = await Note.find(
      { $text: { $search: q } },
      { score: { $meta: "textScore" } },
    )
      .sort({ score: { $meta: "textScore" } })
      .limit(limit)
      .lean();
    return NextResponse.json({
      notes: notes.map((note) => ({
        _id: note._id.toString(),
        title: note.title,
        preview: note.content.slice(0, 200),
        url: note.url,
        status: note.status,
        paperId: note.paperId ? String(note.paperId) : undefined,
        updatedAt: note.updatedAt,
      })),
    });
  } catch (error) {
    console.error("Error searching notes:", error);
    return NextResponse.json(
      { error: "Failed to search notes" },
      { status: 500 },
    );
  }
}
