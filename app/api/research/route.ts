import { currentUser, json } from "@/lib/auth";
import {
  companyResearch,
  holdingsReport,
  socialMentions,
} from "@/lib/research";
import { symbolPattern } from "@/lib/universes";

export async function GET(request: Request) {
  if (!(await currentUser()))
    return json({ error: "Sign in to open research." }, 401);
  const query = new URL(request.url).searchParams;
  try {
    if (query.get("view") === "social") return json(await socialMentions());
    const cik = query.get("cik");
    if (cik && /^\d{1,10}$/.test(cik) && Number(cik) > 0)
      return json(await holdingsReport(cik));
    const symbol = query.get("symbol")?.toUpperCase();
    if (symbol && symbolPattern.test(symbol))
      return json(await companyResearch(symbol));
    return json({ error: "Enter a valid symbol or SEC CIK." }, 400);
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Research is temporarily unavailable.",
      },
      502,
    );
  }
}
