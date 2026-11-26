import { z } from "zod";
import { currentUser, json, sameOrigin } from "@/lib/auth";
import { deleteMemory, updateMemory } from "@/lib/memory";
import { memoryInputSchema } from "@/lib/memory-types";

const idSchema = z.uuid();

export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/memories/[id]">,
) {
  if (!sameOrigin(request)) return json({ error: "Origin not allowed" }, 403);
  const user = await currentUser();
  if (!user) return json({ error: "Sign in to edit memories." }, 401);
  const id = idSchema.safeParse((await ctx.params).id);
  if (!id.success) return json({ error: "Invalid memory id." }, 400);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
  const parsed = memoryInputSchema.safeParse(body);
  if (!parsed.success)
    return json(
      { error: parsed.error.issues[0]?.message ?? "Invalid memory." },
      400,
    );
  const memory = await updateMemory(user.id, id.data, parsed.data);
  return memory ? json(memory) : json({ error: "Memory not found." }, 404);
}

export async function DELETE(
  request: Request,
  ctx: RouteContext<"/api/memories/[id]">,
) {
  if (!sameOrigin(request)) return json({ error: "Origin not allowed" }, 403);
  const user = await currentUser();
  if (!user) return json({ error: "Sign in to edit memories." }, 401);
  const id = idSchema.safeParse((await ctx.params).id);
  if (!id.success) return json({ error: "Invalid memory id." }, 400);
  return (await deleteMemory(user.id, id.data))
    ? json({ ok: true })
    : json({ error: "Memory not found." }, 404);
}
