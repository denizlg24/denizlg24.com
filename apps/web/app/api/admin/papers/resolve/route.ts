import {
  resolvedPaperMetadataSchema,
  resolvePaperMetadataSchema,
} from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { resolvePaperMetadata } from "@/lib/paper-metadata";
import { requireAdmin } from "@/lib/require-admin";

export const maxDuration = 20;

const BAD_REQUEST = "Enter an identifier or a title to look up";

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const parsed = resolvePaperMetadataSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: BAD_REQUEST }, { status: 400 });
    }

    const metadata = resolvedPaperMetadataSchema.parse(
      await resolvePaperMetadata(parsed.data.identifier, parsed.data.kind),
    );
    return NextResponse.json({ metadata });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: BAD_REQUEST }, { status: 400 });
    }
    const message =
      error instanceof Error ? error.message : "Metadata lookup failed";
    const status = /^Enter |^Invalid /.test(message)
      ? 400
      : /not found|No exact/.test(message)
        ? 404
        : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
