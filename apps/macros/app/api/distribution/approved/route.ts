import type { MacrosDistributionApprovedResponse } from "@repo/schemas/macros";
import { NextResponse } from "next/server";
import { isAuthorizedDistributionCi } from "@/lib/distribution/access";
import { listApprovedDevices } from "@/lib/distribution/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isAuthorizedDistributionCi(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const devices = await listApprovedDevices();
  return NextResponse.json({
    devices,
  } satisfies MacrosDistributionApprovedResponse);
}
