import {
  type MacrosReportCase,
  macrosResolveReportBodySchema,
} from "@repo/schemas/macros";
import { NextResponse } from "next/server";
import { z } from "zod";

import { adminRoute, invalid, readJson } from "@/lib/api/admin-route";
import { getCase, resolveCase } from "@/lib/moderation/admin";

const paramsSchema = z.object({ itemId: z.uuid() });

export function GET(
  _request: Request,
  context: { params: Promise<{ itemId: string }> },
) {
  return adminRoute(async () => {
    const params = paramsSchema.safeParse(await context.params);
    if (!params.success) return invalid(params.error.issues);
    const found = await getCase(params.data.itemId);
    if (!found) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(found satisfies MacrosReportCase);
  });
}

export function POST(
  request: Request,
  context: { params: Promise<{ itemId: string }> },
) {
  return adminRoute(async (actor) => {
    const params = paramsSchema.safeParse(await context.params);
    if (!params.success) return invalid(params.error.issues);
    const body = macrosResolveReportBodySchema.safeParse(
      await readJson(request),
    );
    if (!body.success) return invalid(body.error.issues);

    await resolveCase(
      actor,
      params.data.itemId,
      body.data.action,
      body.data.reason || null,
    );
    const updated = await getCase(params.data.itemId);
    return NextResponse.json(updated satisfies MacrosReportCase | null);
  });
}
