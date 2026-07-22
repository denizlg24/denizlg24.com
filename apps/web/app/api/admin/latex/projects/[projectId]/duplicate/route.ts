import { type NextRequest, NextResponse } from "next/server";
import { latexProjectErrorResponse } from "@/lib/latex-project-route";
import { duplicateLatexProject } from "@/lib/latex-projects";
import { isCrossOriginCookieRequest } from "@/lib/request-security";
import { requireAdmin } from "@/lib/require-admin";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  if (isCrossOriginCookieRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    const { projectId } = await context.params;
    return NextResponse.json(
      { project: await duplicateLatexProject(projectId) },
      { status: 201 },
    );
  } catch (error) {
    const handled = latexProjectErrorResponse(error);
    if (handled) return handled;
    console.error("Failed to duplicate LaTeX project", error);
    return NextResponse.json(
      { error: "Failed to duplicate LaTeX project" },
      { status: 500 },
    );
  }
}
