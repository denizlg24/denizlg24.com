import { workspaceRevertSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { readBody, withWorkspace } from "@/lib/workspace/http";

type Context = { params: Promise<{ id: string }> };

/** `{ rev }` restores the page as it stood then; `{ actor, sinceRev? }` undoes one actor's ops. */
export async function POST(request: NextRequest, context: Context) {
  const { id } = await context.params;
  return withWorkspace(request, async (service, caller) => {
    const body = await readBody(request, workspaceRevertSchema);
    if (body.actor !== undefined) {
      return NextResponse.json(
        await service.revertActor(id, body.actor, body.sinceRev ?? 0, caller),
      );
    }
    return NextResponse.json({
      page: await service.revertToRev(id, body.rev ?? 0, caller),
    });
  });
}
