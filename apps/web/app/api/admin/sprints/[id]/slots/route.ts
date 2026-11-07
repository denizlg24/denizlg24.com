import { createSprintSlotSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { readBody, withSprints } from "@/lib/sprints/http";
import { createSlot } from "@/lib/sprints/service";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withSprints(request, async () => {
    const { id } = await params;
    const input = await readBody(request, createSprintSlotSchema);
    return NextResponse.json(
      { slot: await createSlot(id, input) },
      { status: 201 },
    );
  });
}
