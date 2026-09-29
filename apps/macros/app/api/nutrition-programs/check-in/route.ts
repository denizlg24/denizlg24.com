import {
  type MacrosCheckInResponse,
  type MacrosUpsertProgramResponse,
  macrosCheckInBodySchema,
} from "@repo/schemas/macros";
import { NextResponse } from "next/server";
import { getRequiredSession } from "@/lib/api/session";
import {
  checkIn,
  getCheckIn,
  NoProgramError,
} from "@/lib/plans/program-service";

function noProgram(error: unknown) {
  if (!(error instanceof NoProgramError)) throw error;
  return NextResponse.json({ error: error.message }, { status: 409 });
}

export async function GET() {
  const { session, response } = await getRequiredSession();
  if (!session) return response;
  try {
    const result = await getCheckIn(session.user.id);
    return NextResponse.json(result satisfies MacrosCheckInResponse);
  } catch (error) {
    return noProgram(error);
  }
}

export async function POST(request: Request) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;
  const body = await request.json().catch(() => null);
  const parsed = macrosCheckInBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid check-in", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    const result = await checkIn(session.user.id, parsed.data);
    return NextResponse.json(result satisfies MacrosUpsertProgramResponse);
  } catch (error) {
    return noProgram(error);
  }
}
