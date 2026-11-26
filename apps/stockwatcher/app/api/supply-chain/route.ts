import { randomUUID } from "node:crypto";
import { aiEnabled } from "@/lib/ai/config";
import { currentUser, json } from "@/lib/auth";
import { type Balance, reserve } from "@/lib/billing/credits";
import { meter } from "@/lib/billing/meter";
import { withCostScope } from "@/lib/billing/scope";
import { candidates, ownDisclosure, verify } from "@/lib/supply-chain";
import { symbolPattern } from "@/lib/universes";

export const maxDuration = 90;

const outOfCredits = (balance: Balance) =>
  json(
    { error: "You are out of credits.", code: "out_of_credits", balance },
    402,
  );

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
    // A billed read spends the signed-in user's credits, and the Lax session
    // cookie rides along on a cross-site link; only this app may trigger it.
    const site = request.headers.get("sec-fetch-site");
    if (site && site !== "same-origin")
      return json({ error: "Open filings from Stockwatcher itself." }, 403);
    const billed = async (run: () => Promise<Response>) => {
      const reservation = await reserve(user);
      if (!reservation.ok) return outOfCredits(reservation.balance);
      return withCostScope(async (scope) => {
        try {
          return await run();
        } finally {
          await meter(user, reservation, scope.steps, {
            ref: `supply:${randomUUID()}`,
            source: "supply-chain",
          });
        }
      });
    };
    if (part === "own") {
      return await billed(async () => {
        const result = await ownDisclosure(ticker);
        return result
          ? json(result)
          : json({ error: `${ticker} has no SEC annual report on file.` }, 404);
      });
    }
    if (part === "verify") {
      const cik = args.get("cik") ?? "";
      const known = await candidates(ticker);
      if (!known.some((item) => item.cik === cik))
        return json({ error: "Unknown counterparty." }, 400);
      return await billed(async () => json(await verify(ticker, cik)));
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
