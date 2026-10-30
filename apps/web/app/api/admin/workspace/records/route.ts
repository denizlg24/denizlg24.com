import { RECORD_REFS_MAX } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/workspace/http";
import { resolveRecords } from "@/lib/workspace/records";
import { WorkspaceError } from "@/lib/workspace/service";

export const runtime = "nodejs";

/** `?refs=entity:note:x,entity:page:y` → `{ records, missing }`. See `lib/workspace/records.ts`. */
export async function GET(request: NextRequest) {
  return withWorkspace(request, async () => {
    const refs = (request.nextUrl.searchParams.get("refs") ?? "")
      .split(",")
      .map((ref) => ref.trim())
      .filter(Boolean);
    if (refs.length > RECORD_REFS_MAX) {
      throw new WorkspaceError(
        400,
        "INVALID_INPUT",
        `At most ${RECORD_REFS_MAX} refs`,
      );
    }
    return NextResponse.json(await resolveRecords(refs));
  });
}
