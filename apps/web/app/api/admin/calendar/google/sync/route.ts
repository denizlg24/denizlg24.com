import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { backfillManualEventsToGoogle } from "@/lib/google-calendar-sync";
import { requireAdmin } from "@/lib/require-admin";

const syncSchema = z.object({
  start: z.string().datetime().optional(),
  end: z.string().datetime().optional(),
});

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const parsed = syncSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid sync range" }, { status: 400 });
  }

  const now = new Date();
  const start = parsed.data.start ? new Date(parsed.data.start) : now;
  const end = parsed.data.end
    ? new Date(parsed.data.end)
    : new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

  const result = await backfillManualEventsToGoogle({ start, end });
  return NextResponse.json(result, { status: 200 });
}
