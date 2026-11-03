import { createSprintSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { readBody, withSprints } from "@/lib/sprints/http";
import { createSprint, listSprints } from "@/lib/sprints/service";

export async function GET(request: NextRequest) {
  return withSprints(request, async () =>
    NextResponse.json({ sprints: await listSprints() }),
  );
}

export async function POST(request: NextRequest) {
  return withSprints(request, async () => {
    const input = await readBody(request, createSprintSchema);
    return NextResponse.json(
      { sprint: await createSprint(input) },
      { status: 201 },
    );
  });
}
