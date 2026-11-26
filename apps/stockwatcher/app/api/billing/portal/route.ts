import { currentUser, json, sameOrigin } from "@/lib/auth";
import { billingEnabled } from "@/lib/billing/credits";
import { polarReady, portalUrl } from "@/lib/billing/polar";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "Origin not allowed" }, 403);
  const user = await currentUser();
  if (!user || user.demo)
    return json({ error: "Sign in to manage billing." }, 401);
  if (!billingEnabled() || !polarReady())
    return json({ error: "Billing is not open yet." }, 503);
  try {
    return json({ url: await portalUrl(user.id) });
  } catch {
    return json({ error: "There are no purchases on this account yet." }, 404);
  }
}
