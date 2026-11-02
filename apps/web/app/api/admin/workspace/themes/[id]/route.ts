import { themePatchSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { deleteTheme, getTheme, updateTheme } from "@/lib/workspace/appearance";
import { readBody, withWorkspace } from "@/lib/workspace/http";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  return withWorkspace(request, async () =>
    NextResponse.json({ theme: await getTheme(decodeURIComponent(id)) }),
  );
}

export async function PATCH(request: NextRequest, context: Context) {
  const { id } = await context.params;
  return withWorkspace(request, async () => {
    const patch = await readBody(request, themePatchSchema);
    return NextResponse.json({
      theme: await updateTheme(decodeURIComponent(id), patch),
    });
  });
}

export async function DELETE(request: NextRequest, context: Context) {
  const { id } = await context.params;
  return withWorkspace(request, async () => {
    await deleteTheme(decodeURIComponent(id));
    return NextResponse.json({ deleted: true });
  });
}
