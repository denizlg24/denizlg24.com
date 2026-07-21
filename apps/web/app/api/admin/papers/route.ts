import { createPaperSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { serializePaper } from "@/lib/paper-citations";
import { createPaperWithLinkedNote } from "@/lib/paper-notes";
import { isDuplicatePaperError } from "@/lib/paper-route-utils";
import { requireAdmin } from "@/lib/require-admin";
import { Note } from "@/models/Note";
import { type ILeanPaper, Paper } from "@/models/Paper";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    await connectDB();
    const [papers, notes] = await Promise.all([
      Paper.find().sort({ updatedAt: -1 }).lean<ILeanPaper[]>().exec(),
      Note.find()
        .select("_id title url")
        .sort({ updatedAt: -1 })
        .lean<Array<{ _id: unknown; title: string; url?: string }>>()
        .exec(),
    ]);
    return NextResponse.json({
      papers: papers.map(serializePaper),
      notes: notes.map((note) => ({ ...note, _id: String(note._id) })),
    });
  } catch (error) {
    console.error("Failed to load papers:", error);
    return NextResponse.json(
      { error: "Failed to load papers" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const parsed = createPaperSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid paper", issues: parsed.error.flatten() },
        { status: 400 },
      );
    }

    await connectDB();
    const { paper } = await createPaperWithLinkedNote(parsed.data);
    return NextResponse.json({ paper: serializePaper(paper) }, { status: 201 });
  } catch (error) {
    if (isDuplicatePaperError(error)) {
      return NextResponse.json(
        {
          error:
            "A paper with this DOI, arXiv id, or citation key already exists",
        },
        { status: 409 },
      );
    }
    if (error instanceof Error && /^Invalid /.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Failed to create paper:", error);
    return NextResponse.json(
      { error: "Failed to create paper" },
      { status: 500 },
    );
  }
}
