import { type NextRequest, NextResponse } from "next/server";
import {
  latexProjectErrorResponse,
  safeDownloadName,
} from "@/lib/latex-project-route";
import { getLatexProject } from "@/lib/latex-projects";
import { buildLatexSourceZip } from "@/lib/latex-source-zip";
import { requireAdmin } from "@/lib/require-admin";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    const { projectId } = await context.params;
    const record = await getLatexProject(projectId);
    const zip = buildLatexSourceZip(record.project, new Date(record.updatedAt));
    const filename = `${safeDownloadName(record.name, "latex-project")}-source.zip`;
    return new NextResponse(new Uint8Array(zip), {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${filename}"`,
        "content-length": String(zip.byteLength),
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    const handled = latexProjectErrorResponse(error);
    if (handled) return handled;
    console.error("Failed to build LaTeX source archive", error);
    return NextResponse.json(
      { error: "Failed to download LaTeX source" },
      { status: 500 },
    );
  }
}
