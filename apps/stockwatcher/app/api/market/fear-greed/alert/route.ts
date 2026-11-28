import { z } from "zod";
import { createSignal, storedData } from "@/lib/ai/signal-tools";
import { currentUser, json } from "@/lib/auth";
import {
  fearGreedRuleSchema,
  ruleName,
  ruleScript,
} from "@/lib/fear-greed-model";
import { signalCadences } from "@/lib/models";

const bodySchema = z.object({
  rule: fearGreedRuleSchema,
  cadence: z.enum(signalCadences).default("hourly"),
  repeat: z.enum(["once", "rearm"]).default("rearm"),
});

/** The script is built here from a fixed template; the client only picks the rule. */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return json({ error: "Sign in to create alerts." }, 401);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return json({ error: "Choose a threshold from 1 to 99 or a band." }, 400);
  const { rule, cadence, repeat } = parsed.data;
  try {
    const { created, reading } = await createSignal(user.id, {
      name: ruleName(rule),
      data: storedData({ fearGreed: true }),
      code: ruleScript(rule),
      cadence,
      repeat,
      note: "",
    });
    return json({
      id: created.id,
      name: created.name,
      trigger: reading.trigger,
      value: reading.value,
    });
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The alert could not be created.",
      },
      400,
    );
  }
}
