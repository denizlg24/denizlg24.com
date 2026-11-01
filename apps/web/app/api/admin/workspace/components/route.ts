import { componentInputSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { createComponent, listComponents } from "@/lib/workspace/components";
import { readBody, withWorkspace } from "@/lib/workspace/http";

export async function GET(request: NextRequest) {
  return withWorkspace(request, async () =>
    NextResponse.json({ components: await listComponents() }),
  );
}

export async function POST(request: NextRequest) {
  return withWorkspace(request, async (_service, caller) => {
    const input = await readBody(request, componentInputSchema);
    return NextResponse.json(
      { component: await createComponent(input, caller.actor) },
      { status: 201 },
    );
  });
}
