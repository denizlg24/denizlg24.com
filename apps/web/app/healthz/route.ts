import { connection } from "next/server";

// Runtime availability only. Dependency transactions are reported separately.
export async function GET() {
  await connection();
  return Response.json(
    { status: "ok", service: "web" },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
