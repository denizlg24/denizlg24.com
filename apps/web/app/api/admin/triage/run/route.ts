import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { runTriage } from "@/lib/triage";

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const body = await request.json();
  const since = body.since;

  try {
    const stats = await runTriage({ since });
    return new Response(JSON.stringify({ stats }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Triage run failed:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Triage run failed",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
