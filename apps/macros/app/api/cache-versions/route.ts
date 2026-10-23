import { MACROS_CACHE_VERSIONS } from "@repo/schemas/macros";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Public, small and never cached: old cache policy cannot block its own update. */
export function GET() {
  return NextResponse.json(MACROS_CACHE_VERSIONS, {
    headers: { "Cache-Control": "no-store" },
  });
}
