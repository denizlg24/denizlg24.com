import { type NextRequest, NextResponse } from "next/server";
import { removeScheduleEntry } from "@/lib/workspace/appearance";
import { withWorkspace } from "@/lib/workspace/http";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(request: NextRequest, context: Context) {
  const { id } = await context.params;
  return withWorkspace(request, async () =>
    NextResponse.json({ appearance: await removeScheduleEntry(id) }),
  );
}
