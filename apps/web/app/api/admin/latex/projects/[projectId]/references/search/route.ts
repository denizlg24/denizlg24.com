import { latexReferenceSearchSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { latexProjectErrorResponse } from "@/lib/latex-project-route";
import { getLatexProject } from "@/lib/latex-projects";
import { searchLatexReferences } from "@/lib/latex-references";
import { isCrossOriginCookieRequest } from "@/lib/request-security";
import { requireAdmin } from "@/lib/require-admin";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  if (isCrossOriginCookieRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const parsed = latexReferenceSearchSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid reference query", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const { projectId } = await context.params;
    const project = await getLatexProject(projectId);
    return NextResponse.json({
      suggestions: await searchLatexReferences(
        parsed.data.query,
        parsed.data.limit,
        project.project,
        request.signal,
      ),
    });
  } catch (error) {
    const handled = latexProjectErrorResponse(error);
    if (handled) return handled;
    console.error("Failed to search LaTeX references", error);
    return NextResponse.json(
      { error: "Failed to search references" },
      { status: 500 },
    );
  }
}
