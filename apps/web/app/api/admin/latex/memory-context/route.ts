import { type NextRequest, NextResponse } from "next/server";
import { retrieveMemoriesForChat } from "@/lib/agent-memory/retrieval";
import { latexProjectErrorResponse } from "@/lib/latex-project-route";
import { getLatexProject } from "@/lib/latex-projects";
import { requireAdmin } from "@/lib/require-admin";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const projectId = request.nextUrl.searchParams.get("projectId")?.trim();
  const query = request.nextUrl.searchParams
    .get("query")
    ?.trim()
    .slice(0, 8_192);
  if (!projectId || !query) {
    return NextResponse.json(
      { error: "projectId and query are required" },
      { status: 400 },
    );
  }

  try {
    const project = await getLatexProject(projectId);
    const retrieval = await retrieveMemoriesForChat({
      query: `${project.name}\n\n${query}`,
      memoryMode: "enabled",
    });
    return NextResponse.json({
      context: retrieval?.context ?? null,
      trust: "untrusted",
      traceId: retrieval?.traceId ?? null,
      estimatedTokens: retrieval?.estimatedTokens ?? 0,
    });
  } catch (error) {
    const handled = latexProjectErrorResponse(error);
    if (handled) return handled;
    console.error("LaTeX memory context retrieval failed", error);
    return NextResponse.json(
      { error: "Memory context is unavailable" },
      { status: 503 },
    );
  }
}
