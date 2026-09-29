import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/api/cron";
import { sendStreakNudges } from "@/lib/push/streak-nudge";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await sendStreakNudges();

  return NextResponse.json({
    status: "ok",
    ...result,
  });
}
