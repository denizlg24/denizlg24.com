import { currentUser, json } from "@/lib/auth";
import { newsWire, trending } from "@/lib/market";
import { symbolPattern } from "@/lib/universes";

export async function GET(request: Request) {
  if (!(await currentUser()))
    return json({ error: "Sign in to view news." }, 401);
  const args = new URL(request.url).searchParams;
  const requested = [
    ...new Set(
      (args.get("symbols") ?? "").toUpperCase().split(",").filter(Boolean),
    ),
  ];
  if (requested.some((symbol) => !symbolPattern.test(symbol)))
    return json({ error: "Invalid symbol." }, 400);
  try {
    const hot = await trending().catch(() => []);
    const symbols = (requested.length ? requested : hot).slice(0, 40);
    return json({
      items: (await newsWire(symbols)).slice(0, 200),
      trending: hot,
      symbols,
    });
  } catch {
    return json({ error: "News is unavailable." }, 502);
  }
}
