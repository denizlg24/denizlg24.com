import {
  type MacrosDistributionPublishedResponse,
  macrosDistributionPublishedBodySchema,
} from "@repo/schemas/macros";
import { NextResponse } from "next/server";
import { isAuthorizedDistributionCi } from "@/lib/distribution/access";
import { recordPublishedBuild } from "@/lib/distribution/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isAuthorizedDistributionCi(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = macrosDistributionPublishedBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid publish report", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const result = await recordPublishedBuild(
    parsed.data.version,
    parsed.data.udids,
  );
  return NextResponse.json(
    result satisfies MacrosDistributionPublishedResponse,
  );
}
