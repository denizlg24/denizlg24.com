import { surfaceAssetNameSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/workspace/http";
import { WorkspaceError } from "@/lib/workspace/service";
import { removeSurfaceAsset } from "@/lib/workspace/surfaces";

type Context = { params: Promise<{ id: string; name: string }> };

export async function DELETE(request: NextRequest, context: Context) {
  const { id, name } = await context.params;
  return withWorkspace(request, async () => {
    const parsed = surfaceAssetNameSchema.safeParse(name);
    if (!parsed.success) {
      throw new WorkspaceError(400, "INVALID_INPUT", "Invalid asset name");
    }
    return NextResponse.json({
      surface: await removeSurfaceAsset(id, parsed.data),
    });
  });
}
