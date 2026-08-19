import { macrosUpsertProgramBodySchema } from "@repo/schemas/macros";
import { NextResponse } from "next/server";
import { getRequiredSession } from "@/lib/api/session";
import {
  getActiveProgram,
  getTargetHistory,
  upsertProgram,
} from "@/lib/plans/program-service";

export async function GET() {
  const { session, response } = await getRequiredSession();
  if (!session) return response;
  const [program, issues] = await Promise.all([
    getActiveProgram(session.user.id),
    getTargetHistory(session.user.id),
  ]);
  return NextResponse.json({ program, issues });
}

export async function PUT(request: Request) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;
  const body = await request.json().catch(() => null);
  const parsed = macrosUpsertProgramBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid nutrition program", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const result = await upsertProgram(session.user.id, parsed.data);
  return NextResponse.json(result);
}
