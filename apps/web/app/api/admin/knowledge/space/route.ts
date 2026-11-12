import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { queueKnowledgeProjectionJob } from "@/lib/knowledge/queue";
import { drainKnowledgeJobsSoon } from "@/lib/knowledge/reindex";
import { getKnowledgeSpace, scopeOf } from "@/lib/knowledge/space";
import { requireAdmin } from "@/lib/require-admin";
import { NotebookNotFoundError } from "@/lib/study/notebook-sources";

export const maxDuration = 60;

const objectId = z.string().regex(/^[a-f0-9]{24}$/i);
const recomputeSchema = z.object({ notebookId: objectId.optional() });

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const raw = request.nextUrl.searchParams.get("notebookId") || undefined;
  const notebookId = objectId.safeParse(raw);
  if (raw && !notebookId.success) {
    return NextResponse.json({ error: "Invalid notebookId" }, { status: 400 });
  }
  try {
    return NextResponse.json(
      await getKnowledgeSpace({ notebookId: notebookId.data }),
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof NotebookNotFoundError) {
      return NextResponse.json(
        { error: "Notebook not found" },
        { status: 404 },
      );
    }
    console.error("Failed to load knowledge space:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const parsed = recomputeSchema.safeParse(
    await request.json().catch(() => ({})),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid notebookId" }, { status: 400 });
  }
  try {
    await queueKnowledgeProjectionJob(scopeOf(parsed.data.notebookId), {
      force: true,
    });
    drainKnowledgeJobsSoon(1);
    return NextResponse.json({ queued: true }, { status: 202 });
  } catch (error) {
    console.error("Failed to queue space recompute:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
