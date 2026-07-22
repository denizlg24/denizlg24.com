import { importLatexSourceResponseSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import {
  importLatexSourceArchive,
  OverleafTemplateImportError,
} from "@/lib/latex-overleaf";
import { isCrossOriginCookieRequest } from "@/lib/request-security";
import { requireAdmin } from "@/lib/require-admin";

export const runtime = "nodejs";
const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;

function projectName(filename: string): string {
  return (
    filename
      .replace(/\.zip$/i, "")
      .replaceAll("_", " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100) || "Imported LaTeX project"
  );
}

export async function POST(request: NextRequest) {
  if (isCrossOriginCookieRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const declaredSize = Number(request.headers.get("content-length") ?? 0);
    if (declaredSize > MAX_ARCHIVE_BYTES + 1_000_000) {
      throw new OverleafTemplateImportError(
        "The LaTeX source ZIP is larger than 10MB",
        413,
      );
    }
    const formData = await request.formData();
    const archive = formData.get("archive");
    if (
      typeof archive !== "object" ||
      archive === null ||
      !("arrayBuffer" in archive) ||
      !("size" in archive) ||
      !("name" in archive) ||
      typeof archive.size !== "number" ||
      typeof archive.name !== "string"
    ) {
      throw new OverleafTemplateImportError(
        "Choose a ZIP containing your LaTeX source files",
      );
    }
    if (!archive.size || archive.size > MAX_ARCHIVE_BYTES) {
      throw new OverleafTemplateImportError(
        "The LaTeX source ZIP is empty or larger than 10MB",
        413,
      );
    }
    const imported = importLatexSourceArchive(
      new Uint8Array(await archive.arrayBuffer()),
      { name: projectName(archive.name) },
    );
    return NextResponse.json(importLatexSourceResponseSchema.parse(imported));
  } catch (error) {
    if (error instanceof OverleafTemplateImportError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("Failed to import LaTeX source", error);
    return NextResponse.json(
      { error: "Failed to import LaTeX source ZIP" },
      { status: 500 },
    );
  }
}
