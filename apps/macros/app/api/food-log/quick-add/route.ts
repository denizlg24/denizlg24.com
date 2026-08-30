import { NextResponse } from "next/server";

import { getRequiredSession } from "@/lib/api/session";
import { logQuickAddBodySchema } from "@/lib/foods/contracts";
import { logQuickAdd } from "@/lib/foods/service";

export async function POST(request: Request) {
  const { session, response } = await getRequiredSession();

  if (!session) {
    return response;
  }

  const body = await request.json().catch(() => null);
  const parsed = logQuickAddBodySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid quick add entry", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { totals, ...entry } = await logQuickAdd(session.user.id, parsed.data);

  return NextResponse.json({ entry, totals }, { status: 201 });
}
