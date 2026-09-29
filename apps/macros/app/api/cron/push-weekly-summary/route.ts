import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/api/cron";
import { sendWeeklySummaries } from "@/lib/push/weekly-summary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await sendWeeklySummaries();

  return NextResponse.json({
    status: "ok",
    ...result,
  });
}
