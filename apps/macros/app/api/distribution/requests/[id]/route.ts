import {
  type MacrosDistributionBuildDispatch,
  type MacrosDistributionDecisionResponse,
  macrosDistributionDecisionBodySchema,
} from "@repo/schemas/macros";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireOwner } from "@/lib/distribution/access";
import { dispatchAdhocBuild } from "@/lib/distribution/github";
import { decideDistributionRequest } from "@/lib/distribution/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/distribution/requests/[id]">,
) {
  const { session, response } = await requireOwner();
  if (!session) return response;

  const id = z.uuid().safeParse((await context.params).id);
  if (!id.success) {
    return NextResponse.json({ error: "Invalid request id" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsed = macrosDistributionDecisionBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid decision", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const decided = await decideDistributionRequest(id.data, parsed.data.action);
  if (!decided) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  const build: MacrosDistributionBuildDispatch =
    parsed.data.action === "approve"
      ? await dispatchAdhocBuild()
      : "not-applicable";

  return NextResponse.json({
    request: decided,
    build,
  } satisfies MacrosDistributionDecisionResponse);
}
