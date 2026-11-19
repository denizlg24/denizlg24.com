import { currentUser, json, sameOrigin } from "@/lib/auth";
import { addMemory, listMemories } from "@/lib/memory";
import { memoryInputSchema } from "@/lib/memory-types";

export async function GET() {
  const user = await currentUser();
  if (!user) return json({ error: "Sign in to view memories." }, 401);
  return json(await listMemories(user.id));
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "Origin not allowed" }, 403);
  const user = await currentUser();
  if (!user) return json({ error: "Sign in to save memories." }, 401);
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
  try {
    return json(await addMemory(user.id, parsed.data), 201);
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error ? error.message : "The memory could not be saved.",
      },
      409,
    );
  }
}
