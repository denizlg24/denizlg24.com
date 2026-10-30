import { triggerInputSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { createTrigger, listTriggers } from "@/lib/workflows/triggers";
import { readBody, withWorkspace } from "@/lib/workspace/http";

export async function GET(request: NextRequest) {
  return withWorkspace(request, async () =>
    NextResponse.json({ triggers: await listTriggers() }),
  );
}

export async function POST(request: NextRequest) {
  return withWorkspace(request, async () => {
    const input = await readBody(request, triggerInputSchema);
    return NextResponse.json(
      { trigger: await createTrigger(input) },
      { status: 201 },
    );
  });
}
