import { z } from "zod";
import { appOrigin } from "@/lib/auth";
import { finishOAuth } from "@/lib/notify/connect";

/**
 * Discord and Slack send the browser back here after approval. The state
 * names the user, so this works even if the session cookie is not sent.
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/alerts/connect/[kind]/callback">,
) {
  const origin = appOrigin(request);
  const back = (params: Record<string, string>) =>
    Response.redirect(`${origin}/?${new URLSearchParams(params)}#alerts`, 303);
  const kind = z.enum(["discord", "slack"]).safeParse((await ctx.params).kind);
  if (!kind.success)
    return back({ connect: "error", reason: "Unknown channel." });
  const query = new URL(request.url).searchParams;
  const code = query.get("code");
  const state = query.get("state");
  if (!code || !state)
    return back({
      connect: "error",
      reason:
        query.get("error") === "access_denied"
          ? "Cancelled."
          : "Missing approval.",
    });
  try {
    const label = await finishOAuth(kind.data, { code, state }, origin);
    return back({ connect: "ok", channel: label });
  } catch (error) {
    return back({
      connect: "error",
      reason: error instanceof Error ? error.message : "That did not work.",
    });
  }
}
