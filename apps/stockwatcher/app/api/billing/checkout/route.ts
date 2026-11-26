import { z } from "zod";
import { appOrigin, currentUser, json, sameOrigin } from "@/lib/auth";
import { billingEnabled } from "@/lib/billing/credits";
import { createCheckout, polarReady } from "@/lib/billing/polar";

const bodySchema = z.object({ productId: z.uuid() });

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "Origin not allowed" }, 403);
  const user = await currentUser();
  if (!user) return json({ error: "Sign in to buy credits." }, 401);
  if (user.demo)
    return json({ error: "Preview sessions cannot buy credits." }, 403);
  if (!billingEnabled() || !polarReady())
    return json({ error: "Purchases are not open yet." }, 503);
  const input = bodySchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return json({ error: "Choose a credit pack." }, 400);
  try {
    const url = await createCheckout({
      userId: user.id,
      email: user.emailVerified ? user.email : null,
      productId: input.data.productId,
      origin: appOrigin(request),
    });
    return url
      ? json({ url })
      : json({ error: "That credit pack is no longer offered." }, 404);
  } catch (error) {
    console.warn("Polar checkout failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return json({ error: "Checkout could not be started. Try again." }, 502);
  }
}
