import { compileLatexProjectRequestSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import {
  LatexCompileBusyError,
  LatexCompileFailedError,
  runLatexProjectCompilation,
} from "@/lib/latex-compile-run";
import { latexProjectErrorResponse } from "@/lib/latex-project-route";
import { isCrossOriginCookieRequest } from "@/lib/request-security";
import { requireAdmin } from "@/lib/require-admin";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  if (isCrossOriginCookieRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  // The validated source is capped at 4MB; JSON escaping can make the wire
  // representation significantly larger than the source itself.
  if (declaredLength > 10 * 1024 * 1024) {
    return NextResponse.json(
      { error: "Request is too large" },
      { status: 413 },
    );
  }
  const parsed = compileLatexProjectRequestSchema.safeParse(
    await request.json(),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid LaTeX project", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { projectId } = await context.params;
  try {
    const { project, log } = await runLatexProjectCompilation({
      projectId,
      baseRevision: parsed.data.baseRevision,
      project: parsed.data.project,
    });
    return NextResponse.json({ project, log });
  } catch (error) {
    if (error instanceof LatexCompileBusyError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof LatexCompileFailedError) {
      return NextResponse.json(
        { error: error.message, log: error.log, project: error.project },
        { status: 422 },
      );
    }
    const handled = latexProjectErrorResponse(error);
    if (handled) return handled;
    console.error("LaTeX project compilation failed", error);
    return NextResponse.json(
      { error: "Failed to compile LaTeX project" },
      { status: 500 },
    );
  }
}
