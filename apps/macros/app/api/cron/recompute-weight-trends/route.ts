import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/api/cron";
import { recomputeAllAdaptiveEstimates } from "@/lib/weights/expenditure-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await recomputeAllAdaptiveEstimates();

  return NextResponse.json({ status: "ok", ...result });
}
