import { type NextRequest, NextResponse } from "next/server";
import {
  latexProjectErrorResponse,
  safeDownloadName,
} from "@/lib/latex-project-route";
import { getLatexProjectDownload } from "@/lib/latex-projects";
import { requireAdmin } from "@/lib/require-admin";
import { getStorageObject } from "@/lib/storage-api";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    const { projectId } = await context.params;
    const download = await getLatexProjectDownload(projectId);
    if (!download.storageKey || !download.project.compiledPdf) {
      return NextResponse.json(
        { error: "This project has no compiled PDF" },
        { status: 404 },
      );
    }
    const object = await getStorageObject(download.storageKey);
    if (!object) {
      return NextResponse.json(
        { error: "The compiled PDF is unavailable" },
        { status: 404 },
      );
    }
    const disposition =
      request.nextUrl.searchParams.get("download") === "true"
        ? "attachment"
        : "inline";
    const filename = safeDownloadName(
      download.project.compiledPdf.filename,
      "project.pdf",
    );
    return new NextResponse(object.body, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `${disposition}; filename="${filename}"`,
        "cache-control": "private, no-store",
        ...(object.contentLength
          ? { "content-length": String(object.contentLength) }
          : {}),
      },
    });
  } catch (error) {
    const handled = latexProjectErrorResponse(error);
    if (handled) return handled;
    console.error("Failed to download LaTeX PDF", error);
    return NextResponse.json(
      { error: "Failed to download LaTeX PDF" },
      { status: 500 },
    );
  }
}
