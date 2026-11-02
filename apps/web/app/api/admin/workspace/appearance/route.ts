import { appearancePatchSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import {
  getAppearance,
  listThemes,
  patchAppearance,
} from "@/lib/workspace/appearance";
import { readBody, withWorkspace } from "@/lib/workspace/http";

export async function GET(request: NextRequest) {
  return withWorkspace(request, async () => {
    const [appearance, themes] = await Promise.all([
      getAppearance(),
      listThemes(),
    ]);
    return NextResponse.json({ appearance, themes });
  });
}

export async function PATCH(request: NextRequest) {
  return withWorkspace(request, async () => {
    const patch = await readBody(request, appearancePatchSchema);
    return NextResponse.json({ appearance: await patchAppearance(patch) });
  });
}
