import { connection } from "next/server";

export async function GET() {
  await connection();
  return Response.json(
    { status: "ok", service: "stream" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
