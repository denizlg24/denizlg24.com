import { currentUser, json } from "@/lib/auth";
import { aiEnabled } from "@/lib/ai/config";
import { candidates, ownDisclosure, verify } from "@/lib/supply-chain";
import { symbolPattern } from "@/lib/universes";

export const maxDuration = 90;

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return json({ error: "Sign in to view supply chains." }, 401);
  const args = new URL(request.url).searchParams;
  const ticker = (args.get("symbol") ?? "").toUpperCase();
  const part = args.get("part");
  if (!symbolPattern.test(ticker))
    return json({ error: "Choose a valid symbol." }, 400);
  try {
    if (part === "candidates") return json(await candidates(ticker));
    if (!aiEnabled(user))
      return json(
        {
          error:
            "Reading filings needs the AI assistant, which is off for this session.",
        },
        503,
      );
    if (part === "own") {
      const result = await ownDisclosure(ticker);
      return result
        ? json(result)
        : json(
            { error: `${ticker} has no SEC annual report on file.` },
            404,
          );
    }
    if (part === "verify") {
      const cik = args.get("cik") ?? "";
      const known = await candidates(ticker);
      if (!known.some((item) => item.cik === cik))
        return json({ error: "Unknown counterparty." }, 400);
      return json(await verify(ticker, cik));
    }
    return json({ error: "Unknown request." }, 400);
  } catch (error) {
    console.warn("Supply chain lookup failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return json(
      {
        error:
          error instanceof Error && error.message.length < 200
            ? error.message
            : "Supply chain data is unavailable.",
      },
      502,
    );
  }
}
