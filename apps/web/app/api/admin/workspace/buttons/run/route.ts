import { buttonRunRequestSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { lastButtonRun, pressButton } from "@/lib/workspace/buttons";
import { readBody, withWorkspace } from "@/lib/workspace/http";

export const maxDuration = 300;

/** Presses a button: its actions run now, or its agent run starts. */
export async function POST(request: NextRequest) {
  return withWorkspace(request, async (_service, caller) => {
    const input = await readBody(request, buttonRunRequestSchema);
    return NextResponse.json(await pressButton(input, caller));
  });
}

/** The last agent run a button started. */
export async function GET(request: NextRequest) {
  return withWorkspace(request, async () => {
    const params = request.nextUrl.searchParams;
    const parsed = buttonRunRequestSchema.safeParse({
      pageId: params.get("pageId"),
      blockId: params.get("blockId"),
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: "pageId and blockId are required" },
        { status: 400 },
      );
    }
    return NextResponse.json({
      run: await lastButtonRun(parsed.data.pageId, parsed.data.blockId),
    });
  });
}
