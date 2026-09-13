import { type NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { boardStore, renderBoard } from "@/lib/whiteboard-elements";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { id } = await params;
  const store = boardStore(id);
  const rendered = await renderBoard(store);
  if (!rendered.ok) {
    return NextResponse.json(
      { error: rendered.error },
      { status: rendered.status },
    );
  }
  if (rendered.empty) {
    return NextResponse.json({ empty: true, name: rendered.name });
  }
  return new NextResponse(new Uint8Array(rendered.png), {
    status: 200,
    headers: {
      "content-type": "image/png",
      "content-length": String(rendered.png.byteLength),
      "x-whiteboard-name": encodeURIComponent(rendered.name),
      "x-image-width": String(rendered.width),
      "x-image-height": String(rendered.height),
    },
  });
}
