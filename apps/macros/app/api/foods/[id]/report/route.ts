import {
  type MacrosReportFoodResponse,
  macrosReportFoodBodySchema,
} from "@repo/schemas/macros";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getRequiredSession } from "@/lib/api/session";
import { ModerationError, reportFood } from "@/lib/moderation/service";

const paramsSchema = z.object({ id: z.uuid() });

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;

  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) {
    return NextResponse.json({ error: "Invalid food id" }, { status: 400 });
  }
  const body = macrosReportFoodBodySchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!body.success) {
    return NextResponse.json(
      { error: "Invalid report", issues: body.error.issues },
      { status: 400 },
    );
  }

  try {
    const { report, hidden } = await reportFood(
      session.user.id,
      params.data.id,
      body.data,
    );
    return NextResponse.json(
      {
        report: {
          id: report.id,
          reason: report.reason,
          createdAt: report.createdAt.toISOString(),
        },
        hidden,
      } satisfies MacrosReportFoodResponse,
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ModerationError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    throw error;
  }
}
