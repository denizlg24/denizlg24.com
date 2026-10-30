import { type NextRequest, NextResponse } from "next/server";
import { EVENTS_LIST_MAX, recentEvents } from "@/lib/workflows/triggers";
import { withWorkspace } from "@/lib/workspace/http";

/** Recent domain events and what each trigger did with them; `triggerId` narrows to one. */
export async function GET(request: NextRequest) {
  return withWorkspace(request, async () => {
    const params = request.nextUrl.searchParams;
    const limit = Number(params.get("limit") ?? 30);
    const triggerId = params.get("triggerId");
    return NextResponse.json({
      events: await recentEvents({
        limit:
          Number.isInteger(limit) && limit > 0
            ? Math.min(limit, EVENTS_LIST_MAX)
            : 30,
        ...(triggerId ? { triggerId } : {}),
      }),
    });
  });
}
