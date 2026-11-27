import { currentUser, json, sameOrigin } from "@/lib/auth";
import { createGroup, groupNameSchema, listGroups } from "@/lib/thread-library";

export async function GET() {
  const user = await currentUser();
  if (!user) return json({ error: "Sign in to view groups." }, 401);
  return json(await listGroups(user.id));
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "Origin not allowed" }, 403);
  const user = await currentUser();
  if (!user) return json({ error: "Sign in to create groups." }, 401);
  const body: unknown = await request.json().catch(() => null);
  const name = groupNameSchema.safeParse(
    body && typeof body === "object" && "name" in body ? body.name : null,
  );
  if (!name.success) return json({ error: "Give the group a name." }, 400);
  try {
    return json(await createGroup(user.id, name.data), 201);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Could not create." },
      409,
    );
  }
}
