import { knowledgeRetrieveInputSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { retrieveKnowledge } from "@/lib/knowledge/retrieve";
import { requireAdmin } from "@/lib/require-admin";
import { NotebookNotFoundError } from "@/lib/study/notebook-sources";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const parsed = knowledgeRetrieveInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid retrieve input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json(await retrieveKnowledge(parsed.data), {
      status: 200,
    });
  } catch (error) {
    if (error instanceof NotebookNotFoundError) {
      return NextResponse.json(
        { error: "Notebook not found" },
        { status: 404 },
      );
    }
    console.error("Knowledge retrieval failed:", error);
    return NextResponse.json({ error: "Retrieval failed" }, { status: 500 });
  }
}
