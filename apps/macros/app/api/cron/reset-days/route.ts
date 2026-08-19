import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/api/cron";
import { finalizeClosedNutritionDays } from "@/lib/services/day-rollover";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await finalizeClosedNutritionDays();

  return NextResponse.json({
    status: "ok",
    ...result,
  });
}
