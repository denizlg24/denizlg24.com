import { type ILatexProject, latexProjectSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { CvCompileBusyError, compileCvProject } from "@/lib/cv-project";
import {
  type LatexCompileErrorEvent,
  latexCompileEventResponse,
} from "@/lib/latex-compile-stream";
import { LatexCompilationError } from "@/lib/latex-compiler";
import { isCrossOriginCookieRequest } from "@/lib/request-security";
import { requireAdmin } from "@/lib/require-admin";

export const runtime = "nodejs";
export const maxDuration = 120;

function toErrorEvent(error: unknown): LatexCompileErrorEvent {
  if (error instanceof CvCompileBusyError) {
    return {
      type: "error",
      status: 409,
      error: error.message,
      log: "",
      diagnostics: [],
    };
  }
  if (error instanceof LatexCompilationError) {
    return {
      type: "error",
      status: 422,
      error: error.message,
      log: error.log,
      diagnostics: error.diagnostics,
    };
  }
  console.error("CV compilation failed", error);
  return {
    type: "error",
    status: 500,
    error: "Failed to compile CV",
    log: "",
    diagnostics: [],
  };
}

export async function POST(request: NextRequest) {
  if (isCrossOriginCookieRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "Project exceeds 4MB" }, { status: 413 });
  }

  let project: ILatexProject;
  try {
    project = latexProjectSchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      { error: "Invalid LaTeX project" },
      { status: 400 },
    );
  }

  return latexCompileEventResponse(async (onOutput) => {
    const { log, ...payload } = await compileCvProject(project, { onOutput });
    return { log, payload };
  }, toErrorEvent);
}
