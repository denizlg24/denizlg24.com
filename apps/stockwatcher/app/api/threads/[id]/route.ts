import { currentUser, json, sameOrigin } from "@/lib/auth";
import { deleteThread, getThread, threadIdSchema } from "@/lib/memory";
import { threadPatchSchema, updateThread } from "@/lib/thread-library";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/threads/[id]">,
) {
  const user = await currentUser();
  if (!user) return json({ error: "Sign in to view conversations." }, 401);
  const id = threadIdSchema.safeParse((await ctx.params).id);
  if (!id.success) return json({ error: "Invalid conversation id." }, 400);
  const thread = await getThread(user.id, id.data);
  return thread
    ? json(thread)
    : json({ error: "Conversation not found." }, 404);
}

export async function DELETE(
  request: Request,
  ctx: RouteContext<"/api/threads/[id]">,
) {
  if (!sameOrigin(request)) return json({ error: "Origin not allowed" }, 403);
  const user = await currentUser();
  if (!user) return json({ error: "Sign in to edit conversations." }, 401);
  const id = threadIdSchema.safeParse((await ctx.params).id);
  if (!id.success) return json({ error: "Invalid conversation id." }, 400);
  return (await deleteThread(user.id, id.data))
    ? json({ ok: true })
    : json({ error: "Conversation not found." }, 404);
}

/** Rename, file into a group (or `groupId: null`), pin or unpin. */
export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/threads/[id]">,
) {
  if (!sameOrigin(request)) return json({ error: "Origin not allowed" }, 403);
  const user = await currentUser();
  if (!user) return json({ error: "Sign in to edit conversations." }, 401);
  const id = threadIdSchema.safeParse((await ctx.params).id);
  if (!id.success) return json({ error: "Invalid conversation id." }, 400);
  const patch = threadPatchSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!patch.success)
    return json(
      { error: patch.error.issues[0]?.message ?? "Invalid change." },
      400,
    );
  try {
    return (await updateThread(user.id, id.data, patch.data))
      ? json({ ok: true })
      : json({ error: "Conversation not found." }, 404);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Could not update." },
      409,
    );
  }
}
