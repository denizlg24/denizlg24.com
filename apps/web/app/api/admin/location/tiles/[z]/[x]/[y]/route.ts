import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMapTile, MAP_TILE_MAX_ZOOM } from "@/lib/map-tiles";
import { requireAdmin } from "@/lib/require-admin";

export const dynamic = "force-dynamic";

const tileSchema = z
  .object({
    z: z.coerce.number().int().min(0).max(MAP_TILE_MAX_ZOOM),
    x: z.coerce.number().int().min(0),
    y: z.coerce.number().int().min(0),
  })
  .refine((tile) => tile.x < 2 ** tile.z && tile.y < 2 ** tile.z);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ z: string; x: string; y: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const parsed = tileSchema.safeParse(await params);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid tile" }, { status: 400 });
  }
  try {
    const tile = await getMapTile(parsed.data.z, parsed.data.x, parsed.data.y);
    return NextResponse.json(tile, {
      headers: { "Cache-Control": "private, max-age=604800" },
    });
  } catch (error) {
    console.warn("[map-tiles]", error);
    return NextResponse.json({ error: "Tile unavailable" }, { status: 502 });
  }
}
