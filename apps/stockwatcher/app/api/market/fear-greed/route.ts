import { currentUser, json } from "@/lib/auth";
import { getFearGreed } from "@/lib/fear-greed";

export async function GET() {
  if (!(await currentUser()))
    return json({ error: "Sign in to view market data." }, 401);
  try {
    return json(await getFearGreed());
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
