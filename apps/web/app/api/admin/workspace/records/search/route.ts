import { ENTITY_KINDS, entityKindSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/workspace/http";
import { searchRecords } from "@/lib/workspace/records";

export const runtime = "nodejs";

/** `?q=&kind=` (repeatable) → `{ records }`: a few title matches per kind. */
export async function GET(request: NextRequest) {
  return withWorkspace(request, async () => {
    const params = request.nextUrl.searchParams;
    const kinds = params.getAll("kind").flatMap((kind) => {
      const parsed = entityKindSchema.safeParse(kind);
      return parsed.success ? [parsed.data] : [];
    });
    return NextResponse.json({
      records: await searchRecords(
        params.get("q") ?? "",
        kinds.length > 0 ? kinds : ENTITY_KINDS,
      ),
    });
  });
}
