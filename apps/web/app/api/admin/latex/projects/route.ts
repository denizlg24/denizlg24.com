import { createLatexProjectSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { latexProjectErrorResponse } from "@/lib/latex-project-route";
import { createLatexProject, listLatexProjects } from "@/lib/latex-projects";
import { isCrossOriginCookieRequest } from "@/lib/request-security";
import { requireAdmin } from "@/lib/require-admin";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    const includeArchived =
      request.nextUrl.searchParams.get("includeArchived") === "true";
    return NextResponse.json({
      projects: await listLatexProjects({ includeArchived }),
    });
  } catch (error) {
    console.error("Failed to list LaTeX projects", error);
    return NextResponse.json(
      { error: "Failed to load LaTeX projects" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  if (isCrossOriginCookieRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const parsed = createLatexProjectSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid LaTeX project", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json(
      { project: await createLatexProject(parsed.data) },
      { status: 201 },
    );
  } catch (error) {
    const handled = latexProjectErrorResponse(error);
    if (handled) return handled;
    console.error("Failed to create LaTeX project", error);
    return NextResponse.json(
      { error: "Failed to create LaTeX project" },
      { status: 500 },
    );
  }
}
