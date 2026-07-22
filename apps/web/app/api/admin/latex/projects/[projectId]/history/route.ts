import {
  latexProjectHistoryDetailResponseSchema,
  latexProjectHistoryListResponseSchema,
  restoreLatexProjectHistoryResponseSchema,
  restoreLatexProjectHistorySchema,
} from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import {
  getLatexProjectHistoryRevision,
  listLatexProjectHistory,
  recordLatexProjectSnapshot,
} from "@/lib/latex-project-history";
import { latexProjectErrorResponse } from "@/lib/latex-project-route";
import { getLatexProject, updateLatexProject } from "@/lib/latex-projects";
import { isCrossOriginCookieRequest } from "@/lib/request-security";
import { requireAdmin } from "@/lib/require-admin";

export const runtime = "nodejs";

async function projectIdFrom(context: {
  params: Promise<{ projectId: string }>;
}) {
  return (await context.params).projectId;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    const projectId = await projectIdFrom(context);
    const current = await getLatexProject(projectId);
    const snapshotId = request.nextUrl.searchParams.get("snapshotId");
    if (snapshotId) {
      const revision = await getLatexProjectHistoryRevision(
        projectId,
        snapshotId,
      );
      if (!revision) {
        return NextResponse.json(
          { error: "Project revision not found" },
          { status: 404 },
        );
      }
      return NextResponse.json(
        latexProjectHistoryDetailResponseSchema.parse({ revision }),
      );
    }
    let revisions = await listLatexProjectHistory(projectId);
    if (revisions.length === 0) {
      await recordLatexProjectSnapshot(current, "create");
      revisions = await listLatexProjectHistory(projectId);
    }
    return NextResponse.json(
      latexProjectHistoryListResponseSchema.parse({
        revisions,
      }),
    );
  } catch (error) {
    const handled = latexProjectErrorResponse(error);
    if (handled) return handled;
    console.error("Failed to load LaTeX project history", error);
    return NextResponse.json(
      { error: "Failed to load project history" },
      { status: 500 },
    );
  }
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
  const parsed = restoreLatexProjectHistorySchema.safeParse(
    await request.json(),
  );
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid history restore request",
        issues: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }
  try {
    const projectId = await projectIdFrom(context);
    const current = await getLatexProject(projectId);
    const snapshot = await getLatexProjectHistoryRevision(
      projectId,
      parsed.data.snapshotId,
    );
    if (!snapshot) {
      return NextResponse.json(
        { error: "Project revision not found" },
        { status: 404 },
      );
    }
    const project = await updateLatexProject(
      projectId,
      {
        baseRevision: parsed.data.baseRevision,
        project: { ...snapshot.project, name: current.name },
      },
      { historyAction: "restore" },
    );
    return NextResponse.json(
      restoreLatexProjectHistoryResponseSchema.parse({ project }),
    );
  } catch (error) {
    const handled = latexProjectErrorResponse(error);
    if (handled) return handled;
    console.error("Failed to restore LaTeX project history", error);
    return NextResponse.json(
      { error: "Failed to restore project revision" },
      { status: 500 },
    );
  }
}
