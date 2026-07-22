import {
  latexDataPointSearchResponseSchema,
  latexDataPointSearchSchema,
} from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { searchLatexDataPoints } from "@/lib/latex-data-points";
import { latexProjectErrorResponse } from "@/lib/latex-project-route";
import { getLatexProject } from "@/lib/latex-projects";
import { isCrossOriginCookieRequest } from "@/lib/request-security";
import { requireAdmin } from "@/lib/require-admin";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  if (isCrossOriginCookieRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const parsed = latexDataPointSearchSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data-point query", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const { projectId } = await context.params;
    const project = await getLatexProject(projectId);
    const result = await searchLatexDataPoints(
      project,
      parsed.data.query,
      parsed.data.limit,
      request.signal,
    );
    return NextResponse.json(latexDataPointSearchResponseSchema.parse(result));
  } catch (error) {
    const handled = latexProjectErrorResponse(error);
    if (handled) return handled;
    console.error("Failed to search LaTeX data points", error);
    return NextResponse.json(
      { error: "Failed to search verified data points" },
      { status: 500 },
    );
  }
}
