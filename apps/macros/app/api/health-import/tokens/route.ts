import { macrosHealthImportTokenBodySchema } from "@repo/schemas/macros";
import { NextResponse } from "next/server";
import { getRequiredSession } from "@/lib/api/session";
import { createHealthImportToken } from "@/lib/body/service";

export async function POST(request: Request) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;
  const parsed = macrosHealthImportTokenBodySchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid token request", issues: parsed.error.issues },
      { status: 400 },
    );
  return NextResponse.json(
    {
      token: await createHealthImportToken(
        session.user.id,
        parsed.data.source,
        parsed.data.label,
      ),
    },
    { status: 201 },
  );
}
