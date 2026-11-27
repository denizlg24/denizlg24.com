import { z } from "zod";
import { currentUser, json, sameOrigin } from "@/lib/auth";
import {
  deleteGroup,
  groupNameSchema,
  renameGroup,
} from "@/lib/thread-library";

async function owner(request: Request) {
  if (!sameOrigin(request))
    return { error: json({ error: "Origin not allowed" }, 403) };
  const user = await currentUser();
  if (!user) return { error: json({ error: "Sign in first." }, 401) };
  return { user };
}

export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/thread-groups/[id]">,
) {
  const auth = await owner(request);
  if ("error" in auth) return auth.error;
  const id = z.uuid().safeParse((await ctx.params).id);
  const body: unknown = await request.json().catch(() => null);
  const name = groupNameSchema.safeParse(
    body && typeof body === "object" && "name" in body ? body.name : null,
  );
  if (!id.success || !name.success)
    return json({ error: "Give the group a name." }, 400);
  return (await renameGroup(auth.user.id, id.data, name.data))
    ? json({ ok: true })
    : json({ error: "Group not found." }, 404);
}

export async function DELETE(
  request: Request,
  ctx: RouteContext<"/api/thread-groups/[id]">,
) {
  const auth = await owner(request);
  if ("error" in auth) return auth.error;
  const id = z.uuid().safeParse((await ctx.params).id);
  if (!id.success) return json({ error: "Invalid group id." }, 400);
  return (await deleteGroup(auth.user.id, id.data))
    ? json({ ok: true })
    : json({ error: "Group not found." }, 404);
}
