import { templateInsertSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { readBody, withWorkspace, workspaceClock } from "@/lib/workspace/http";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  const { id } = await context.params;
  return withWorkspace(request, async (service, caller) => {
    const input = await readBody(request, templateInsertSchema);
    return NextResponse.json({
      page: await service.insertTemplate(
        id,
        input,
        caller,
        await workspaceClock(),
      ),
    });
  });
}
