import { type NextRequest, NextResponse } from "next/server";
import { withSprints } from "@/lib/sprints/http";
import { listCalendarSlots, SprintError } from "@/lib/sprints/service";

function dateParam(value: string | null, name: string): Date {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    throw new SprintError(400, "INVALID_INPUT", `Invalid ${name}`);
  }
  return date;
}

export async function GET(request: NextRequest) {
  return withSprints(request, async () => {
    const params = request.nextUrl.searchParams;
    const from = dateParam(params.get("from"), "from");
    const to = dateParam(params.get("to"), "to");
    return NextResponse.json({ slots: await listCalendarSlots(from, to) });
  });
}
