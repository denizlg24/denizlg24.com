import { updateSprintSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { readBody, withSprints } from "@/lib/sprints/http";
import {
  deleteSprint,
  getSprintDetail,
  updateSprint,
} from "@/lib/sprints/service";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  return withSprints(request, async () => {
    const { id } = await params;
    return NextResponse.json(await getSprintDetail(id));
  });
}

export async function PATCH(request: NextRequest, { params }: Context) {
  return withSprints(request, async () => {
    const { id } = await params;
    const input = await readBody(request, updateSprintSchema);
    return NextResponse.json({ sprint: await updateSprint(id, input) });
  });
}

export async function DELETE(request: NextRequest, { params }: Context) {
  return withSprints(request, async () => {
    const { id } = await params;
    return NextResponse.json(await deleteSprint(id));
  });
}
