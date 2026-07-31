import { tickerSchema } from "@repo/markets/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deleteWatchlist, updateWatchlist } from "@/lib/markets/watchlists";
import { requireAdmin } from "@/lib/require-admin";

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  tickers: z.array(tickerSchema).max(200).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid watchlist" }, { status: 400 });
  }

  const { id } = await params;
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
  if (!(await deleteWatchlist(id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
