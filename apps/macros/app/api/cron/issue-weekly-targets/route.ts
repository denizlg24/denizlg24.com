import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/api/cron";
import { runWeeklyProgramCheckIns } from "@/lib/plans/program-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    status: "ok",
    ...(await runWeeklyProgramCheckIns()),
  });
}
