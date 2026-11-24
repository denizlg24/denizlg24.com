import { currentUser, json, sameOrigin } from "@/lib/auth";
import { readWorkspace, saveWorkspace } from "@/lib/db";

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return json({ error: "Origin not allowed" }, 403);
  const user = await currentUser();
  if (!user) return json({ error: "Sign in first." }, 401);
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await readWorkspace(user.id);
    if (
      await saveWorkspace(user.id, current.revision, {
        ...current.data,
        alertLog: [],
      })
    )
      return json({ ok: true });
  }
  return json({ error: "Workspace is busy. Try again." }, 409);
}
