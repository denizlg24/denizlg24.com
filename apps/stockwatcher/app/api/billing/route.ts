import { currentUser, json } from "@/lib/auth";
import {
  balance,
  billingEnabled,
  ledger,
  usageByDay,
} from "@/lib/billing/credits";
import { creditPacks, polarReady } from "@/lib/billing/polar";

export async function GET() {
  const user = await currentUser();
  if (!user) return json({ error: "Sign in to view credits." }, 401);
  if (!billingEnabled() || user.demo) return json({ enabled: false });
  try {
    const [current, entries, days, packs] = await Promise.all([
      balance(user.id),
      ledger(user.id, 100),
      usageByDay(user.id, 30),
      polarReady()
        ? creditPacks().catch((error: unknown) => {
            console.warn("Polar products unavailable", {
              name: error instanceof Error ? error.name : "UnknownError",
            });
            return [];
          })
        : Promise.resolve([]),
    ]);
    return json({
      enabled: true,
      purchasable: polarReady(),
      balance: current,
      ledger: entries,
      days,
      packs,
    });
  } catch {
    return json({ error: "Credits could not be loaded." }, 502);
  }
}
