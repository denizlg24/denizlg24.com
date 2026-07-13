import { type NextRequest, NextResponse } from "next/server";
import { LlmConfigurationError, LlmModelError } from "@/lib/llm-errors";
import { streamText } from "@/lib/llm-service";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { Note } from "@/models/Note";

export const maxDuration = 120;

const SYSTEM_PROMPT = `You clean up and restructure hastily typed class notes. Your job is strictly to enhance what the user wrote filling in with missing information if the user requires so.
You can add tables, examples if requested.

Rules:
- Fix typos, grammar, and punctuation
- Expand obvious abbreviations (e.g. "bc" → "because", "w/" → "with") only when unambiguous
- Organize the content with clear headings, bullet points, or numbered lists where appropriate
- Preserve the original meaning, terminology, and level of detail exactly
- Keep the same language the notes were written in
- Do NOT add filler that wasn't in the original notes
- Output only the enhanced note content in markdown, nothing else`;

export const POST = async (
  req: NextRequest,
  { params }: { params: Promise<{ noteId: string }> },
) => {
  const { noteId } = await params;
  if (!noteId || typeof noteId !== "string") {
    return NextResponse.json({ error: "Invalid note ID" }, { status: 400 });
  }
  const adminError = await requireAdmin(req);
  if (adminError) return adminError;
  try {
    await connectDB();
    const note = await Note.findById(noteId);
    if (!note) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }
    const {
      additionalInfo,
      model = "anthropic/claude-sonnet-4.5",
      content,
    } = await req.json();
    const prompt = `Enhance the following note content:\n\n${content}${additionalInfo ? `\n\nAdditional information to consider:\n${additionalInfo}` : ""}`;

    const sseStream = await streamText({
      purpose: "enhance-note",
      source: "enhance-note",
      system: SYSTEM_PROMPT,
      prompt,
      model,
    });

    return new Response(sseStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    if (error instanceof LlmModelError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof LlmConfigurationError) {
      return NextResponse.json(
        { error: "LLM service is not configured" },
        { status: 500 },
      );
    }
    console.error("Error enhancing note:", error);
    return NextResponse.json(
      { error: "Failed to enhance note" },
      { status: 500 },
    );
  }
};
