import { type NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/workspace/http";

/** Pages changed since `?since=` (the previous answer's `cursor`); polled while a client is in view. */
export async function GET(request: NextRequest) {
  return withWorkspace(request, async (service) =>
    NextResponse.json(
      await service.changes(request.nextUrl.searchParams.get("since")),
      { headers: { "Cache-Control": "no-store" } },
    ),
  );
}
