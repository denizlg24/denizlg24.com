import {
  type MacrosDistributionRegisteredResponse,
  macrosDistributionRegisteredBodySchema,
} from "@repo/schemas/macros";
import { NextResponse } from "next/server";
import { isAuthorizedDistributionCi } from "@/lib/distribution/access";
import { recordRegistrations } from "@/lib/distribution/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isAuthorizedDistributionCi(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = macrosDistributionRegisteredBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid registrations", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const updated = await recordRegistrations(parsed.data.items);
  return NextResponse.json({
    updated,
  } satisfies MacrosDistributionRegisteredResponse);
}
