import {
  resolvedPaperMetadataSchema,
  resolvePaperMetadataSchema,
} from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { resolvePaperMetadata } from "@/lib/paper-metadata";
import { requireAdmin } from "@/lib/require-admin";

export const maxDuration = 20;

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const parsed = resolvePaperMetadataSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Enter a DOI, arXiv identifier, or Semantic Scholar URL" },
        { status: 400 },
      );
    }

    const metadata = resolvedPaperMetadataSchema.parse(
      await resolvePaperMetadata(parsed.data.identifier),
    );
    return NextResponse.json({ metadata });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "Enter a DOI, arXiv identifier, or Semantic Scholar URL" },
        { status: 400 },
      );
    }
    const message =
      error instanceof Error ? error.message : "Metadata lookup failed";
    const status = /Enter a DOI|Invalid/.test(message)
      ? 400
      : /not found/.test(message)
        ? 404
        : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
