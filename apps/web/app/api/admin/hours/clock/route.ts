import { workClockActionSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { clockWorkSession } from "@/lib/work-hours";
import { hoursErrorResponse } from "../errors";

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const parsed = workClockActionSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }
  try {
    return NextResponse.json({ session: await clockWorkSession(parsed.data) });
  } catch (error) {
    return hoursErrorResponse(error, "Clock action failed");
  }
}
