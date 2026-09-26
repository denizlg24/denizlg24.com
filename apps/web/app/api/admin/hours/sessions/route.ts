import { workSessionInputSchema, workSessionsQuerySchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { createWorkSession, listWorkSessions } from "@/lib/work-hours";
import { hoursErrorResponse } from "../errors";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const params = request.nextUrl.searchParams;
  const parsed = workSessionsQuerySchema.safeParse({
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    jobId: params.get("jobId") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }
  try {
    return NextResponse.json({
      sessions: await listWorkSessions(parsed.data),
    });
  } catch (error) {
    return hoursErrorResponse(error, "Failed to list shifts");
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const parsed = workSessionInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid shift" },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json(
      { session: await createWorkSession(parsed.data) },
      { status: 201 },
    );
  } catch (error) {
    return hoursErrorResponse(error, "Failed to add shift");
  }
}
