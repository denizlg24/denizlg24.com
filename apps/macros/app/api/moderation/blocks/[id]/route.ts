import { NextResponse } from "next/server";
import { z } from "zod";

import { getRequiredSession } from "@/lib/api/session";
import { unblock } from "@/lib/moderation/service";

const paramsSchema = z.object({ id: z.uuid() });

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;

  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  if (!(await unblock(session.user.id, parsed.data.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return new NextResponse(null, { status: 204 });
}
