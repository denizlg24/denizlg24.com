import {
  type MacrosHealthSyncResult,
  macrosHealthImportBodySchema,
} from "@repo/schemas/macros";
import { NextResponse } from "next/server";
import { getRequiredSession } from "@/lib/api/session";
import { importHealthDataForUser } from "@/lib/body/service";

export async function POST(request: Request) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;
  const parsed = macrosHealthImportBodySchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid sync", issues: parsed.error.issues },
      { status: 400 },
    );
  const result: MacrosHealthSyncResult = await importHealthDataForUser(
    session.user.id,
    parsed.data,
  );
  return NextResponse.json(result);
}
