import {
  type ImportOverleafTemplateResponse,
  importOverleafTemplateRequestSchema,
  importOverleafTemplateResponseSchema,
} from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import {
  importOverleafTemplate,
  importOverleafTemplateArchive,
  OverleafTemplateImportError,
} from "@/lib/latex-overleaf";
import { isCrossOriginCookieRequest } from "@/lib/request-security";
import { requireAdmin } from "@/lib/require-admin";

export const runtime = "nodejs";
const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;

export async function POST(request: NextRequest) {
  if (isCrossOriginCookieRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    const contentType = request.headers.get("content-type") ?? "";
    let imported: ImportOverleafTemplateResponse;
    if (contentType.includes("multipart/form-data")) {
      const declaredSize = Number(request.headers.get("content-length") ?? 0);
      if (declaredSize > MAX_ARCHIVE_BYTES + 1_000_000) {
        throw new OverleafTemplateImportError(
          "The Overleaf source ZIP is larger than 10MB",
          413,
        );
      }
      const formData = await request.formData();
      const parsed = importOverleafTemplateRequestSchema.safeParse({
        url: formData.get("url"),
      });
      const archive = formData.get("archive");
      if (!parsed.success) {
        throw new OverleafTemplateImportError(
          "Enter a valid Overleaf template URL",
        );
      }
      if (
        typeof archive !== "object" ||
        archive === null ||
        !("arrayBuffer" in archive) ||
        !("size" in archive) ||
        typeof archive.size !== "number"
      ) {
        throw new OverleafTemplateImportError(
          "Choose the source ZIP downloaded from Overleaf",
        );
      }
      if (!archive.size || archive.size > MAX_ARCHIVE_BYTES) {
        throw new OverleafTemplateImportError(
          "The Overleaf source ZIP is empty or larger than 10MB",
          413,
        );
      }
      const preview = await importOverleafTemplate(parsed.data.url);
      imported = importOverleafTemplateArchive(
        preview,
        new Uint8Array(await archive.arrayBuffer()),
      );
    } else {
      const parsed = importOverleafTemplateRequestSchema.safeParse(
        await request.json(),
      );
      if (!parsed.success) {
        throw new OverleafTemplateImportError(
          "Enter a valid Overleaf template URL",
        );
      }
      imported = await importOverleafTemplate(parsed.data.url);
    }
    return NextResponse.json(
      importOverleafTemplateResponseSchema.parse(imported),
    );
  } catch (error) {
    if (error instanceof OverleafTemplateImportError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("Failed to import Overleaf template", error);
    return NextResponse.json(
      { error: "Failed to import Overleaf template" },
      { status: 500 },
    );
  }
}
