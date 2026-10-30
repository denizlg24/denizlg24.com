import { buttonRunRequestSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/workspace/http";
import { sectionState } from "@/lib/workspace/sections";

/** An agent section's last run, next run and pending proposal. */
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
      state: await sectionState(parsed.data.pageId, parsed.data.blockId),
    });
  });
}
