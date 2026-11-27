import { z } from "zod";
import { aiEnabled } from "@/lib/ai/config";
import { currentUser, json, sameOrigin } from "@/lib/auth";
import { claimNow, runClaimed } from "@/lib/routine-runner";

export const maxDuration = 200;

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/routines/[id]/run">,
) {
  if (!sameOrigin(request)) return json({ error: "Origin not allowed" }, 403);
  const user = await currentUser();
  if (!user) return json({ error: "Sign in to run a routine." }, 401);
  if (!aiEnabled(user))
    return json({ error: "The assistant is unavailable." }, 503);
  const id = z.uuid().safeParse((await ctx.params).id);
  if (!id.success) return json({ error: "Invalid routine id." }, 400);
  const claimed = await claimNow(user.id, id.data);
  if (!claimed.ok) return json({ error: claimed.error }, 409);
  const outcome = await runClaimed(user.id, claimed.routine, user);
  return outcome.ok
    ? json({ ok: true, threadId: outcome.threadId, credits: outcome.credits })
    : json({ error: outcome.error }, 502);
}
