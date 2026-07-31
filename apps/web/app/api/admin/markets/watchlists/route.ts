import { tickerSchema } from "@repo/markets/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createWatchlist, listWatchlists } from "@/lib/markets/watchlists";
import { requireAdmin } from "@/lib/require-admin";

const inputSchema = z.object({
  name: z.string().min(1).max(80),
  tickers: z.array(tickerSchema).max(200).optional(),
});

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  return NextResponse.json({ watchlists: await listWatchlists() });
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid watchlist" }, { status: 400 });
  }
  return NextResponse.json(
    { watchlist: await createWatchlist(parsed.data) },
    { status: 201 },
  );
}
