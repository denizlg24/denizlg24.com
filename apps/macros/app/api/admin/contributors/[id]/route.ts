import type { MacrosContributorDetail } from "@repo/schemas/macros";
import { NextResponse } from "next/server";

import { adminRoute } from "@/lib/api/admin-route";
import { getContributor } from "@/lib/moderation/admin";

export function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return adminRoute(async () => {
    const { id } = await context.params;
    const detail = await getContributor(id);
    if (!detail) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(detail satisfies MacrosContributorDetail);
  });
}
