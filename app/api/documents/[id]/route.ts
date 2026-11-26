import { currentUser, json, sameOrigin } from "@/lib/auth";
import { deleteDocument } from "@/lib/documents/store";
import { documentIdSchema } from "@/lib/documents/types";

export async function DELETE(
  request: Request,
  ctx: RouteContext<"/api/documents/[id]">,
) {
  if (!sameOrigin(request)) return json({ error: "Origin not allowed" }, 403);
  const user = await currentUser();
  if (!user) return json({ error: "Sign in to edit documents." }, 401);
  if (user.demo)
    return json({ error: "Documents are not available in the demo." }, 403);
  const id = documentIdSchema.safeParse((await ctx.params).id);
  if (!id.success) return json({ error: "Invalid document id." }, 400);
  return (await deleteDocument(user.id, id.data))
    ? json({ ok: true })
    : json({ error: "Document not found." }, 404);
}
