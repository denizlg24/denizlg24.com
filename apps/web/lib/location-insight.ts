import { formatMoney } from "@repo/utils";
import { z } from "zod";
import {
  type BudgetSnapshot,
  getBudgetSnapshot,
} from "@/lib/finance/budget-overview";
import { generateJson } from "@/lib/llm-service";
import { buildStoreBrief, type StoreBrief } from "@/lib/location-brief";
import { pushLocationAlert } from "@/lib/mobile-push";
import { connectDB } from "@/lib/mongodb";
import { type ILocationVisit, LocationVisit } from "@/models/Location";

/**
 * Whether walking into a shop deserves a message, decided once per arrival.
 *
 * Code does everything that can be counted: which named place is the shop,
 * what the owner has spent there, which envelope it draws on and how much of
 * it is left per day. The model only gets the verdict and the wording, from
 * numbers it is handed, and is told that silence is the normal answer — a
 * notification on every supermarket visit would be ignored within a week,
 * which is exactly what happened to the finance alerts.
 */

/** One message per shop in this long, however often CoreLocation re-reports it. */
const REPEAT_HOURS = 12;
const DEFAULT_MODEL = "anthropic/claude-haiku-5.5";

const decisionSchema = z.object({
  notify: z.boolean(),
  title: z.string().trim().max(60).nullable().optional(),
  body: z.string().trim().max(180).nullable().optional(),
  reason: z.string().trim().max(200),
});

const SYSTEM = `You decide whether to send one short phone notification to the owner, who has just walked into a shop. He runs his own budget and reads every notification, so each one must be worth reading.

You get facts as JSON: the shop, his purchase history there, and the budget envelope that shop's spending draws on. All money is already formatted; never compute new amounts, never invent numbers, use only figures given.

Notify only when a figure would change what he buys right now:
- the envelope is already over, or would be after a typical basket here
- what is left per day is less than a typical basket here
- he has been here unusually often this month and spent a lot of it here
Stay silent when he is comfortably within budget, when there is no envelope and nothing unusual, or when the facts are thin. Silence is the normal answer.

If you notify: title is the shop name and the one number that matters (max 40 characters); body is one or two terse sentences with the figures (max 140 characters). No greetings, no advice beyond the numbers, no emoji.

Answer with JSON only: {"notify": boolean, "title": string|null, "body": string|null, "reason": string}. reason is a few words on why, kept for the record either way.`;

function factsFor(brief: StoreBrief) {
  const money = (minor: number) => formatMoney(minor, brief.currency);
  return {
    shop: brief.place.name,
    shopKind: brief.place.category?.replace("MKPOICategory", "") ?? null,
    history: brief.merchant
      ? {
          purchasesLast120Days: brief.merchant.purchases,
          typicalBasket: money(brief.merchant.medianMinor),
          thisMonth: `${money(brief.merchant.thisMonthMinor)} over ${brief.merchant.thisMonthPurchases} purchases`,
          lastPurchase: brief.merchant.lastPurchase,
          category: brief.merchant.category,
        }
      : null,
    envelope: brief.envelope
      ? {
          name: brief.envelope.name,
          limit: money(brief.envelope.limitMinor),
          spent: money(brief.envelope.spentMinor),
          stillCommitted: money(brief.envelope.committedMinor),
          left: money(brief.envelope.availableMinor),
          overBudget: brief.envelope.availableMinor < 0,
          daysLeftInPeriod: brief.envelope.daysLeft,
          leftPerDay: money(brief.envelope.perDayMinor),
          projectedAtPeriodEnd: money(brief.envelope.projectedMinor),
          typicalBasketExceedsPerDay:
            brief.merchant !== null &&
            brief.merchant.medianMinor > brief.envelope.perDayMinor,
        }
      : null,
  };
}

async function decide(brief: StoreBrief) {
  const facts = factsFor(brief);
  try {
    const result = await generateJson<unknown>({
      purpose: "llm-api",
      source: "location-store-insight",
      model: process.env.LOCATION_INSIGHT_MODEL?.trim() || DEFAULT_MODEL,
      temperature: 0,
      system: SYSTEM,
      user: JSON.stringify(facts),
    });
    const parsed = decisionSchema.safeParse(result.json);
    if (parsed.success) return parsed.data;
    console.warn("[location-insight] unreadable decision", result.content);
  } catch (error) {
    console.warn("[location-insight] decision failed", error);
  }
  // Without a verdict only the unambiguous case is worth a message.
  if (brief.envelope && brief.envelope.availableMinor < 0) {
    return {
      notify: true,
      title: `${brief.place.name}: ${brief.envelope.name} over`,
      body: `${facts.envelope?.left} left in ${brief.envelope.name}, ${brief.envelope.daysLeft} days to go.`,
      reason: "model unavailable; envelope over",
    };
  }
  return {
    notify: false,
    title: null,
    body: null,
    reason: "model unavailable",
  };
}

async function judge(visit: ILocationVisit, snapshot: BudgetSnapshot) {
  const brief = buildStoreBrief({ places: visit.places, snapshot });
  if ("skip" in brief) {
    return {
      place: visit.places[0]?.name ?? "",
      notified: false,
      title: null,
      body: null,
      reason: brief.skip,
    };
  }
  const since = new Date(visit.arrivedAt.getTime() - REPEAT_HOURS * 3_600_000);
  const repeat = await LocationVisit.exists({
    _id: { $ne: visit._id },
    arrivedAt: { $gte: since },
    "insight.place": brief.place.name,
    "insight.notified": true,
  });
  if (repeat) {
    return {
      place: brief.place.name,
      notified: false,
      title: null,
      body: null,
      reason: `already notified within ${REPEAT_HOURS} h`,
    };
  }
  const decision = await decide(brief);
  const title = decision.notify ? (decision.title ?? brief.place.name) : null;
  const body = decision.notify ? (decision.body ?? null) : null;
  const notified =
    Boolean(decision.notify && body) &&
    (await pushLocationAlert({
      title: title ?? brief.place.name,
      body: body ?? "",
    }));
  return {
    place: brief.place.name,
    notified,
    title,
    body,
    reason: decision.reason,
  };
}

/**
 * Judges each arrival once. The claim is written before any work so a batch
 * the phone resends while the first is still being judged finds it taken.
 */
export async function judgeVisitArrivals(ids: string[]) {
  await connectDB();
  let snapshot: BudgetSnapshot | null = null;
  for (const id of ids) {
    const claimed = await LocationVisit.findOneAndUpdate(
      { _id: id, insight: { $exists: false }, departedAt: { $exists: false } },
      {
        $set: {
          insight: {
            place: "",
            notified: false,
            title: null,
            body: null,
            reason: "judging",
            decidedAt: new Date(),
          },
        },
      },
      { new: true },
    );
    if (!claimed) continue;
    try {
      snapshot ??= await getBudgetSnapshot(new Date());
      const insight = await judge(claimed, snapshot);
      await LocationVisit.updateOne(
        { _id: id },
        { $set: { insight: { ...insight, decidedAt: new Date() } } },
      );
    } catch (error) {
      console.error("[location-insight] judging failed", id, error);
      await LocationVisit.updateOne(
        { _id: id },
        {
          $set: { "insight.reason": "failed", "insight.decidedAt": new Date() },
        },
      );
    }
  }
}
