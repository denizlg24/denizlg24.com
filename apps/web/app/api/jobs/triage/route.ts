import { runTriage } from "@/lib/triage";

export async function GET(request: Request) {
  if (
    request.headers.get("Authorization") !==
    `Bearer ${process.env.TRIAGE_JOB_BEARER_TOKEN}`
  ) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const stats = await runTriage();
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
