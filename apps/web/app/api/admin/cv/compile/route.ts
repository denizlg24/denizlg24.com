import { type ILatexProject, latexProjectSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { CvCompileBusyError, compileCvProject } from "@/lib/cv-project";
import { LatexCompilationError } from "@/lib/latex-compiler";
import { isCrossOriginCookieRequest } from "@/lib/request-security";
import { requireAdmin } from "@/lib/require-admin";

export const runtime = "nodejs";
export const maxDuration = 120;

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

  try {
    return NextResponse.json(await compileCvProject(project));
  } catch (error) {
    if (error instanceof CvCompileBusyError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof LatexCompilationError) {
      return NextResponse.json(
        { error: error.message, log: error.log },
        { status: 422 },
      );
    }
    console.error("CV compilation failed", error);
    return NextResponse.json(
      { error: "Failed to compile CV" },
      { status: 500 },
    );
  }
}
