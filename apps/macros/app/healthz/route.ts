import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db/connection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ status: "ok", service: "macros" });
  } catch {
    return NextResponse.json(
      { status: "unavailable", service: "macros" },
      { status: 503 },
    );
  }
}
