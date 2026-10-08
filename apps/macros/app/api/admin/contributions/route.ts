import {
  type MacrosContributionsResponse,
  macrosContributionsQuerySchema,
} from "@repo/schemas/macros";
import { NextResponse } from "next/server";

import { adminRoute, invalid } from "@/lib/api/admin-route";
import { listContributions } from "@/lib/moderation/admin";

export function GET(request: Request) {
  return adminRoute(async () => {
    const params = new URL(request.url).searchParams;
    const query = macrosContributionsQuerySchema.safeParse({
      status: params.get("status") ?? undefined,
      q: params.get("q") ?? undefined,
      contributor: params.get("contributor") ?? undefined,
      cursor: params.get("cursor") ?? undefined,
      limit: params.get("limit") ?? undefined,
    });
    if (!query.success) return invalid(query.error.issues);
    return NextResponse.json(
      (await listContributions(
        query.data,
      )) satisfies MacrosContributionsResponse,
    );
  });
}
