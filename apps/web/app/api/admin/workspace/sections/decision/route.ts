import { buttonRunRequestSchema, sectionDecisionSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { readBody, withWorkspace } from "@/lib/workspace/http";
import { decideSection } from "@/lib/workspace/sections";

const bodySchema = buttonRunRequestSchema.extend(sectionDecisionSchema.shape);

/** Accepts (writes, as the caller) or rejects an agent section's proposal. */
export async function POST(request: NextRequest) {
  return withWorkspace(request, async (_service, caller) => {
    const { pageId, blockId, decision } = await readBody(request, bodySchema);
    return NextResponse.json({
      state: await decideSection(pageId, blockId, decision, caller),
    });
  });
}
