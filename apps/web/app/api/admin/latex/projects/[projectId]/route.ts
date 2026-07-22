import { updateLatexProjectSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { latexProjectErrorResponse } from "@/lib/latex-project-route";
import {
  deleteLatexProject,
  getLatexProject,
  updateLatexProject,
} from "@/lib/latex-projects";
import { isCrossOriginCookieRequest } from "@/lib/request-security";
import { requireAdmin } from "@/lib/require-admin";
import { deleteFileFromStorage } from "@/lib/storage-api";

export const runtime = "nodejs";

async function projectIdFrom(context: {
  params: Promise<{ projectId: string }>;
}): Promise<string> {
  return (await context.params).projectId;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    return NextResponse.json({
      project: await getLatexProject(await projectIdFrom(context)),
    });
  } catch (error) {
    const handled = latexProjectErrorResponse(error);
    if (handled) return handled;
    console.error("Failed to load LaTeX project", error);
    return NextResponse.json(
      { error: "Failed to load LaTeX project" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  if (isCrossOriginCookieRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const parsed = updateLatexProjectSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid project update", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json({
      project: await updateLatexProject(
        await projectIdFrom(context),
        parsed.data,
      ),
    });
  } catch (error) {
    const handled = latexProjectErrorResponse(error);
    if (handled) return handled;
    console.error("Failed to update LaTeX project", error);
    return NextResponse.json(
      { error: "Failed to update LaTeX project" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  if (isCrossOriginCookieRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    const deleted = await deleteLatexProject(await projectIdFrom(context));
    if (deleted.compiledPdf?.storageKey) {
      await deleteFileFromStorage(deleted.compiledPdf.storageKey).catch(
        (error) => console.error("Failed to remove LaTeX PDF", error),
      );
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const handled = latexProjectErrorResponse(error);
    if (handled) return handled;
    console.error("Failed to delete LaTeX project", error);
    return NextResponse.json(
      { error: "Failed to delete LaTeX project" },
      { status: 500 },
    );
  }
}
