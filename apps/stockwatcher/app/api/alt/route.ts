import { altHandlers } from "@/lib/alt/registry";
import { AltUnavailable } from "@/lib/alt/types";
import { currentUser, json } from "@/lib/auth";

export async function GET(request: Request) {
  if (!(await currentUser()))
    return json({ error: "Sign in to view this data." }, 401);
  const params = new URL(request.url).searchParams;
  const dataset = params.get("dataset") ?? "";
  const handler = Object.hasOwn(altHandlers, dataset)
    ? altHandlers[dataset]
    : undefined;
  if (!handler) return json({ error: "Unknown dataset." }, 404);
  try {
    return json(await handler(params));
  } catch (error) {
    if (error instanceof AltUnavailable)
      return json({ error: error.message }, error.status);
    console.error("Stockwatcher alt dataset failed", {
      dataset,
      error: error instanceof Error ? error.message.slice(0, 300) : "unknown",
    });
    return json({ error: "This data is unavailable right now." }, 502);
  }
}
