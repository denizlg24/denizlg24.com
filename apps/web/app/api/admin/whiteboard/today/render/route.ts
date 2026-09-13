import { type NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { renderBoard, todayBoardStore } from "@/lib/whiteboard-elements";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const store = todayBoardStore;
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
