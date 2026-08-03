import { agentTaskScheduleSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { previewCronOccurrences } from "@/lib/agent-tasks/cron";
import { resolveDefaultTimeZone } from "@/lib/agent-tasks/service";
import { requireAdmin } from "@/lib/require-admin";

/**
 * Resolves a cron pattern to its next firings so the editor can show what the
 * expression means before it is saved. Also serves the app time zone, which is
 * what an unspecified schedule falls back to.
 */
export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const timeZone =
    request.nextUrl.searchParams.get("timeZone") ??
    (await resolveDefaultTimeZone());
  const cron = request.nextUrl.searchParams.get("cron");
  if (!cron) return NextResponse.json({ timeZone, occurrences: [] });

  const parsed = agentTaskScheduleSchema.safeParse({ cron, timeZone });
  if (!parsed.success) {
    return NextResponse.json(
      { timeZone, occurrences: [], error: parsed.error.issues[0]?.message },
      { status: 200 },
    );
  }
  try {
    return NextResponse.json({
      timeZone,
      occurrences: previewCronOccurrences({
        cron: parsed.data.cron,
        timeZone: parsed.data.timeZone,
        count: 3,
      }).map((date) => date.toISOString()),
    });
  } catch (error) {
    return NextResponse.json({
      timeZone,
      occurrences: [],
      error: error instanceof Error ? error.message : "Invalid cron expression",
    });
  }
}
