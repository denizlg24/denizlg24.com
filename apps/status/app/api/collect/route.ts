import { revalidateTag } from "next/cache";
import { validBearer } from "@/lib/auth";
import { collectStatus } from "@/lib/collector";
export const maxDuration = 120;
export async function GET(request: Request) {
  if (
    !validBearer(
      request.headers.get("authorization"),
      process.env.STATUS_CRON_SECRET,
    )
  )
    return new Response("Unauthorized", { status: 401 });
  try {
    const result = await collectStatus();
    revalidateTag("status-public", { expire: 0 });
    return Response.json(
      { ok: true, skipped: result.skipped },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error(
      "Status collection failed",
      error instanceof Error ? error.name : "unknown",
    );
    return Response.json(
      {
        ok: false,
        error: "Collection failed; check server configuration and logs.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
export const POST = GET;
