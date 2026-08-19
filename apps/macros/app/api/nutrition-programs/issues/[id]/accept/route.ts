import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequiredSession } from "@/lib/api/session";
import { acceptPendingIssue } from "@/lib/plans/program-service";

export async function POST(
  _request: Request,
  context: RouteContext<"/api/nutrition-programs/issues/[id]/accept">,
) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;
  const parsed = z.uuid().safeParse((await context.params).id);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid issue id" }, { status: 400 });
  }
  const issue = await acceptPendingIssue(session.user.id, parsed.data);
  if (!issue) {
    return NextResponse.json(
      { error: "Pending issue not found" },
      { status: 404 },
    );
  }
  return NextResponse.json({ issue });
}
