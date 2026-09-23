import { compileLatexProjectRequestSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import {
  LatexCompileBusyError,
  LatexCompileFailedError,
  runLatexProjectCompilation,
} from "@/lib/latex-compile-run";
import {
  type LatexCompileErrorEvent,
  latexCompileEventResponse,
} from "@/lib/latex-compile-stream";
import {
  LatexProjectNotFoundError,
  LatexProjectRevisionConflictError,
} from "@/lib/latex-projects";
import { isCrossOriginCookieRequest } from "@/lib/request-security";
import { requireAdmin } from "@/lib/require-admin";

export const runtime = "nodejs";
export const maxDuration = 120;

function toErrorEvent(error: unknown): LatexCompileErrorEvent {
  const base = { type: "error" as const, log: "", diagnostics: [] };
  if (error instanceof LatexCompileBusyError) {
    return { ...base, status: 409, error: error.message };
  }
  if (error instanceof LatexCompileFailedError) {
    return {
      type: "error",
      status: 422,
      error: error.message,
      log: error.log,
      diagnostics: error.diagnostics,
      payload: { project: error.project },
    };
  }
  if (error instanceof LatexProjectNotFoundError) {
    return { ...base, status: 404, error: error.message };
  }
  if (error instanceof LatexProjectRevisionConflictError) {
    return {
      ...base,
      status: 409,
      error: error.message,
      payload: { project: error.current },
    };
  }
  console.error("LaTeX project compilation failed", error);
  return { ...base, status: 500, error: "Failed to compile LaTeX project" };
}

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
  return latexCompileEventResponse(async (onOutput) => {
    const { project, log } = await runLatexProjectCompilation(
      {
        projectId,
        baseRevision: parsed.data.baseRevision,
        project: parsed.data.project,
      },
      { onOutput },
    );
    return { log, payload: { project } };
  }, toErrorEvent);
}
