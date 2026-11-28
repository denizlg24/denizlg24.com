import { currentUser, json } from "@/lib/auth";
import { getFearGreedHistory, spxCloses } from "@/lib/fear-greed";
import type { Close, FearGreedHistoryResponse } from "@/lib/fear-greed-model";

export async function GET() {
  if (!(await currentUser()))
    return json({ error: "Sign in to view market data." }, 401);
  try {
    const data = await getFearGreedHistory();
    const from = data.days[0]?.day;
    let spx: Close[] = [];
    let spxError: string | null = null;
    if (from) {
      try {
        spx = await spxCloses(from);
      } catch (error) {
        spxError =
          error instanceof Error
            ? error.message.slice(0, 200)
            : "S&P 500 closes are unavailable.";
      }
    }
    const body: FearGreedHistoryResponse = { ...data, spx, spxError };
    return json(body);
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "CNN Fear & Greed is unavailable right now.",
      },
      502,
    );
  }
}
