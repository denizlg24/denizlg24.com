import { surfaceInputSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { readBody, withWorkspace } from "@/lib/workspace/http";
import { createSurface, listSurfaces } from "@/lib/workspace/surfaces";

export async function GET(request: NextRequest) {
  return withWorkspace(request, async () =>
    NextResponse.json({ surfaces: await listSurfaces() }),
  );
}

export async function POST(request: NextRequest) {
  return withWorkspace(request, async (_service, caller) => {
    const input = await readBody(request, surfaceInputSchema);
    return NextResponse.json(
      { surface: await createSurface(input, caller) },
      { status: 201 },
    );
  });
}
