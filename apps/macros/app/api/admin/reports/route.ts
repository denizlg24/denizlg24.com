import {
  type MacrosReportCasesResponse,
  macrosReportStatusFilterSchema,
} from "@repo/schemas/macros";
import { NextResponse } from "next/server";

import { adminRoute, invalid } from "@/lib/api/admin-route";
import { listCases } from "@/lib/moderation/admin";

export function GET(request: Request) {
  return adminRoute(async () => {
    const status = macrosReportStatusFilterSchema.safeParse(
      new URL(request.url).searchParams.get("status") ?? "open",
    );
    if (!status.success) return invalid(status.error.issues);
    return NextResponse.json({
      cases: await listCases(status.data),
    } satisfies MacrosReportCasesResponse);
  });
}
