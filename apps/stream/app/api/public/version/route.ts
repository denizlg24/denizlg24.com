import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { version: process.env.NEXT_PUBLIC_STREAM_BUILD ?? "dev" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
