import { watchlistInputSchema } from "@repo/markets/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { parseObjectId } from "@/lib/markets/route-params";
import { deleteWatchlist, updateWatchlist } from "@/lib/markets/watchlists";
import { requireAdmin } from "@/lib/require-admin";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const parsed = watchlistInputSchema
    .partial()
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid watchlist" }, { status: 400 });
  }

  const { id } = await params;
  if (!parseObjectId(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const watchlist = await updateWatchlist(id, parsed.data);
  if (!watchlist) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ watchlist });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { id } = await params;
  if (!parseObjectId(id) || !(await deleteWatchlist(id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
