import { currentUser, json, sameOrigin } from "@/lib/auth";
import { createToken, listTokens, tokenInputSchema } from "@/lib/mcp/tokens";

export async function GET() {
  const user = await currentUser();
  if (!user) return json({ error: "Sign in first." }, 401);
  if (user.demo) return json({ tokens: [] });
  return json({ tokens: await listTokens(user.id) });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "Origin not allowed" }, 403);
  const user = await currentUser();
  if (!user) return json({ error: "Sign in first." }, 401);
  if (user.demo)
    return json({ error: "Access tokens are off in preview sessions." }, 403);
  const parsed = tokenInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return json({ error: "Give the token a name and a scope." }, 400);
  try {
    return json(await createToken(user.id, parsed.data), 201);
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error ? error.message : "The token was not created.",
      },
      409,
    );
  }
}
