import { z } from "zod";
import { appOrigin, currentUser, json, sameOrigin } from "@/lib/auth";
import { connectKinds, connectUrl } from "@/lib/notify/connect";

/** Starts a one-click connection; the client opens the returned URL. */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/alerts/connect/[kind]">,
) {
  if (!sameOrigin(request)) return json({ error: "Origin not allowed" }, 403);
  const user = await currentUser();
  if (!user) return json({ error: "Sign in first." }, 401);
  if (user.demo)
    return json({ error: "Notifications are off in preview sessions." }, 403);
  const kind = z.enum(connectKinds).safeParse((await ctx.params).kind);
  if (!kind.success) return json({ error: "Unknown channel." }, 404);
  try {
    return json({
      url: await connectUrl(user.id, kind.data, appOrigin(request)),
    });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Could not start." },
      409,
    );
  }
}
