import { z } from "zod";
import { currentUser, json, sameOrigin } from "@/lib/auth";
import { revokeToken } from "@/lib/mcp/tokens";

export async function DELETE(
  request: Request,
  ctx: RouteContext<"/api/account/tokens/[id]">,
) {
  if (!sameOrigin(request)) return json({ error: "Origin not allowed" }, 403);
  const user = await currentUser();
  if (!user) return json({ error: "Sign in first." }, 401);
  const id = z.uuid().safeParse((await ctx.params).id);
  if (!id.success) return json({ error: "Invalid token id." }, 400);
  return (await revokeToken(user.id, id.data))
    ? json({ ok: true })
    : json({ error: "Token not found." }, 404);
}
