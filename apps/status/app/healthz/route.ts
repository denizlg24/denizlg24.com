import { connection } from "next/server";
import { collections } from "@/lib/db";
export async function GET() {
  await connection();
  try {
    const c = await collections();
    const snapshot = await c.snapshots.findOne(
      { _id: "latest" },
      { projection: { at: 1 } },
    );
    const fresh = !!snapshot && Date.now() - Date.parse(snapshot.at) < 180_000;
    return Response.json(
      { service: "status", status: fresh ? "ok" : "degraded" },
      { status: fresh ? 200 : 503, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { service: "status", status: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
