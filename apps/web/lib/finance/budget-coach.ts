import type {
  FinanceBudgetSuggestionAction,
  FinanceBudgetSuggestion as FinanceBudgetSuggestionWire,
} from "@repo/schemas";
import {
  financeBudgetSuggestionActionSchema,
  financeEnvelopePeriodSchema,
} from "@repo/schemas";
import { majorToMinor, minorToMajor } from "@repo/utils";
import mongoose from "mongoose";
import { z } from "zod";
import { generateJson } from "@/lib/llm-service";
import { connectDB } from "@/lib/mongodb";
import {
  FinanceBudgetSuggestion,
  type IFinanceBudgetSuggestion,
} from "@/models/Finance";
import { listFinanceBudgetAlerts } from "./budget-alerts";
import { type BudgetSnapshot, getBudgetSnapshot } from "./budget-overview";
import { listFinanceCategories } from "./categories";
import { monthlyEquivalentMinor, periodsPerYear } from "./envelope-math";
import {
  addFinanceEnvelopeContribution,
  createFinanceEnvelope,
  draftFinanceEnvelopes,
  getFinanceEnvelope,
  updateFinanceEnvelope,
} from "./envelopes";

/**
 * The advisory half of budgeting.
 *
 * Alerts state facts; a suggestion proposes a change, which is a judgement
 * call, which is where a model earns its keep. Two rules keep it honest:
 *
 *  - The model never sees the ledger and never does arithmetic. It is handed
 *    precomputed per-category history, envelope status and open alerts, and
 *    every amount it may propose is one it was given. A model asked to add up
 *    transactions will confidently get it wrong, and a budget built on a wrong
 *    total is worse than no budget.
 *  - Every suggestion is either mechanically applicable — it names an envelope
 *    and a number the code can write — or it is explicitly `advice` with no
 *    action. There is no third category where "apply" quietly does nothing.
 *
 * Amounts cross the model boundary as major-unit decimals, because a model
 * reasoning about "350" as euros is far more reliable than one reasoning about
 * "35000" as cents; they are converted back on the way in.
 */

const MAX_SUGGESTIONS = 8;
const HISTORY_PERIODS = 6;

const ACTION_KINDS = [
  "set_limit",
  "create_envelope",
  "reallocate",
  "adjust_contribution",
  "advice",
] as const;

/**
 * Synonyms a model reaches for instead of the two kinds that exist.
 *
 * `fixed` maps to `capped` deliberately: a model using it means "a fixed
 * recurring cost", which is still a spending limit. Only a goal with a
 * deadline is a sinking fund.
 */
const ENVELOPE_KIND_SYNONYMS: Record<string, "capped" | "sinking"> = {
  capped: "capped",
  cap: "capped",
  fixed: "capped",
  flexible: "capped",
  limit: "capped",
  spending: "capped",
  variable: "capped",
  fund: "sinking",
  goal: "sinking",
  saving: "sinking",
  savings: "sinking",
  sinking: "sinking",
  target: "sinking",
};

const ROLLOVER_SYNONYMS: Record<string, "none" | "surplus" | "both"> = {
  none: "none",
  off: "none",
  no: "none",
  reset: "none",
  carry: "surplus",
  surplus: "surplus",
  yes: "surplus",
  both: "both",
  full: "both",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reshapes a near-miss action into the discriminated union.
 *
 * Models reliably emit `{create_envelope: {...}}` — tagging by key rather than
 * by a `kind` field — and invent enum values that read correctly in English
 * (`flexible`, `rollover: false`). None of that is worth a failed run, and the
 * intent is unambiguous in every case handled here. Anything genuinely
 * ambiguous is left alone so validation rejects it.
 */
export function normalizeCoachAction(action: unknown): unknown {
  if (!isRecord(action)) return action;

  let shaped = action;
  if (typeof shaped.kind !== "string") {
    const tag = ACTION_KINDS.find((kind) => kind in shaped);
    if (!tag) return shaped;
    const payload = shaped[tag];
    shaped = { kind: tag, ...(isRecord(payload) ? payload : {}) };
  }

  const next: Record<string, unknown> = { ...shaped };
  if (typeof next.envelopeKind === "string") {
    next.envelopeKind =
      ENVELOPE_KIND_SYNONYMS[next.envelopeKind.toLowerCase()] ??
      next.envelopeKind;
  }
  if (typeof next.rollover === "boolean") {
    next.rollover = next.rollover ? "surplus" : "none";
  } else if (typeof next.rollover === "string") {
    next.rollover =
      ROLLOVER_SYNONYMS[next.rollover.toLowerCase()] ?? next.rollover;
  }
  return next;
}

export function normalizeCoachSuggestion(suggestion: unknown): unknown {
  if (!isRecord(suggestion)) return suggestion;
  return { ...suggestion, action: normalizeCoachAction(suggestion.action) };
}

const suggestionSchema = z.object({
  title: z.string().trim().min(1).max(120),
  rationale: z.string().trim().max(600).default(""),
  /** Signed monthly effect on headroom, positive meaning money freed. */
  impact: z.number().optional(),
  action: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("set_limit"),
      envelopeId: z.string().min(1),
      limit: z.number().nonnegative(),
    }),
    z.object({
      kind: z.literal("create_envelope"),
      name: z.string().trim().min(1).max(80),
      categories: z.array(z.string().trim().min(1)).max(40),
      limit: z.number().nonnegative(),
      period: financeEnvelopePeriodSchema.default("monthly"),
      envelopeKind: z.enum(["capped", "sinking"]).default("capped"),
      rollover: z.enum(["none", "surplus", "both"]).default("none"),
      targetDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    }),
    z.object({
      kind: z.literal("reallocate"),
      fromEnvelopeId: z.string().min(1),
      toEnvelopeId: z.string().min(1),
      amount: z.number().positive(),
    }),
    z.object({
      kind: z.literal("adjust_contribution"),
      envelopeId: z.string().min(1),
      amount: z.number(),
    }),
    z.object({ kind: z.literal("advice") }),
  ]),
});

export type CoachSuggestion = z.infer<typeof suggestionSchema>;

/**
 * Parses the batch one suggestion at a time.
 *
 * A single malformed entry used to throw away four good ones. The run is worth
 * more than strictness here: bad entries are dropped and counted, and only a
 * response with no recognisable envelope at all is an error.
 */
export function parseCoachSuggestions(payload: unknown) {
  const container = isRecord(payload) ? payload.suggestions : payload;
  if (!Array.isArray(container)) return undefined;
  const accepted: CoachSuggestion[] = [];
  let rejected = 0;
  for (const entry of container.slice(0, MAX_SUGGESTIONS)) {
    const parsed = suggestionSchema.safeParse(normalizeCoachSuggestion(entry));
    if (parsed.success) accepted.push(parsed.data);
    else rejected += 1;
  }
  return { suggestions: accepted, rejected };
}

export function serializeFinanceBudgetSuggestion(
  suggestion: IFinanceBudgetSuggestion,
): FinanceBudgetSuggestionWire {
  return {
    id: suggestion._id.toString(),
    title: suggestion.title,
    rationale: suggestion.rationale,
    impactMinor: suggestion.impactMinor,
    currency: suggestion.currency,
    // Stored as Mixed, so it is re-validated on the way out rather than cast:
    // a suggestion written by an older shape must not crash the page.
    action: financeBudgetSuggestionActionSchema
      .catch({
        kind: "advice" as const,
      })
      .parse(suggestion.action),
    status: suggestion.status,
    generatedAt: suggestion.generatedAt.toISOString(),
    resolvedAt: suggestion.resolvedAt?.toISOString(),
  };
}

export async function listFinanceBudgetSuggestions(
  options: {
    status?: Array<"open" | "applied" | "dismissed">;
    limit?: number;
  } = {},
): Promise<FinanceBudgetSuggestionWire[]> {
  await connectDB();
  const rows = await FinanceBudgetSuggestion.find({
    status: { $in: options.status ?? ["open"] },
  })
    .sort({ generatedAt: -1 })
    .limit(Math.min(Math.max(options.limit ?? 50, 1), 100));
  return rows.map(serializeFinanceBudgetSuggestion);
}

/** Everything the model is allowed to reason from, and nothing else. */
function buildCoachContext(input: {
  snapshot: BudgetSnapshot;
  alerts: Awaited<ReturnType<typeof listFinanceBudgetAlerts>>;
  drafts: Awaited<ReturnType<typeof draftFinanceEnvelopes>>;
  categories: string[];
}) {
  const { snapshot } = input;
  const major = (amount: number) => minorToMajor(amount, snapshot.currency);
  return {
    asOfDate: snapshot.asOfDate,
    currency: snapshot.currency,
    monthlyTotals: {
      planned: major(snapshot.totals.plannedMinor),
      spent: major(snapshot.totals.spentMinor),
      committed: major(snapshot.totals.committedMinor),
      available: major(snapshot.totals.availableMinor),
      projected: major(snapshot.totals.projectedMinor),
      unbudgeted: major(snapshot.totals.unbudgetedMinor),
      income: major(snapshot.totals.incomeMinor),
    },
    forecast: snapshot.forecast
      ? {
          endOfMonthLow: major(snapshot.forecast.p25Minor),
          endOfMonthMid: major(snapshot.forecast.p50Minor),
          endOfMonthHigh: major(snapshot.forecast.p75Minor),
          daysRemaining: snapshot.forecast.daysRemaining,
        }
      : null,
    envelopes: snapshot.statuses.map((status) => ({
      envelopeId: status.envelopeId,
      name: status.name,
      kind: status.kind,
      period: status.period,
      limit: major(status.limitMinor),
      monthlyEquivalent: major(
        monthlyEquivalentMinor(status.limitMinor, status.period),
      ),
      carryIn: major(status.carryInMinor),
      spent: major(status.spentMinor),
      committed: major(status.committedMinor),
      available: major(status.availableMinor),
      projected: major(status.projectedMinor),
      paceRatio: status.paceRatio,
      entryCount: status.entryCount,
      ...(status.kind === "sinking"
        ? {
            saved: major(status.savedMinor ?? 0),
            requiredPerPeriod: major(status.requiredPerPeriodMinor ?? 0),
            periodsRemaining: status.periodsRemaining,
            onTrack: status.onTrack,
          }
        : {}),
    })),
    unbudgetedCategories: snapshot.unbudgeted.map((row) => ({
      category: row.category ?? "uncategorized",
      spent: major(row.spentMinor),
      entryCount: row.entryCount,
    })),
    /** Median spend per category over recent periods — the basis for any
     *  limit the model proposes. It must not invent a different one. */
    categoryHistory: input.drafts.map((draft) => ({
      category: draft.name,
      medianPerMonth: major(draft.medianMinor),
      periodsWithSpend: draft.periodsObserved,
    })),
    openAlerts: input.alerts.map((alert) => ({
      kind: alert.kind,
      severity: alert.severity,
      title: alert.title,
      envelopeId: alert.envelopeId,
      category: alert.category,
    })),
    knownCategories: input.categories,
  };
}

const COACH_SYSTEM = [
  "You advise the owner of a personal finance ledger on their spending plan.",
  "You are given precomputed figures. Never recompute, estimate or invent an amount: every number you emit must come from the context or be a round adjustment of one you were given, and you must say which.",
  "Amounts are decimal major units of the stated currency.",
  "Return JSON {suggestions: [...]}, at most 6, ordered by how much they matter.",
  "Each suggestion has a title, a rationale of at most two sentences, an optional signed `impact` (monthly effect on spare money, positive means freed up), and an action.",
  "The action is a flat object whose `kind` field names it. Do not nest the fields under the action name.",
  'Example: {"title":"Cap Groceries","rationale":"Median spend is 190 over six months.","impact":-10,"action":{"kind":"create_envelope","name":"Groceries","categories":["Groceries"],"limit":200,"period":"monthly","envelopeKind":"capped","rollover":"none"}}',
  "Action kinds and their fields: set_limit {envelopeId, limit}; create_envelope {name, categories, limit, period, envelopeKind, rollover, targetDate?}; reallocate {fromEnvelopeId, toEnvelopeId, amount}; adjust_contribution {envelopeId, amount}; advice {} for anything with no mechanical change.",
  'period is exactly one of "weekly", "monthly", "quarterly", "yearly".',
  'envelopeKind is exactly one of "capped" (a spending limit that resets each period) or "sinking" (saving toward a one-off, which also requires targetDate as YYYY-MM-DD). A recurring bill is "capped", not "sinking".',
  'rollover is exactly one of "none", "surplus", "both" — a string, never a boolean.',
  "Only reference envelopeIds and category names present in the context.",
  "Prefer few, specific, defensible changes. Say nothing rather than pad the list, and do not restate an alert the owner can already see without proposing what to do about it.",
  "No greetings, no encouragement, no explanations of what budgeting is.",
].join(" ");

function toMinor(amountMajor: number, currency: string) {
  return majorToMinor(amountMajor, currency);
}

function actionToWire(
  action: CoachSuggestion["action"],
  currency: string,
): FinanceBudgetSuggestionAction {
  if (action.kind === "set_limit") {
    return {
      kind: "set_limit",
      envelopeId: action.envelopeId,
      limitMinor: toMinor(action.limit, currency),
    };
  }
  if (action.kind === "create_envelope") {
    return {
      kind: "create_envelope",
      name: action.name,
      categories: action.categories,
      limitMinor: toMinor(action.limit, currency),
      period: action.period,
      envelopeKind: action.envelopeKind,
      rollover: action.rollover,
      targetDate: action.targetDate,
    };
  }
  if (action.kind === "reallocate") {
    return {
      kind: "reallocate",
      fromEnvelopeId: action.fromEnvelopeId,
      toEnvelopeId: action.toEnvelopeId,
      amountMinor: toMinor(action.amount, currency),
    };
  }
  if (action.kind === "adjust_contribution") {
    return {
      kind: "adjust_contribution",
      envelopeId: action.envelopeId,
      amountMinor: toMinor(action.amount, currency),
    };
  }
  return { kind: "advice" };
}

/**
 * Drops a suggestion whose action points at something that does not exist.
 * A model naming a hallucinated envelope id would otherwise produce a button
 * that fails when pressed, which is worse than the suggestion being absent.
 */
function actionIsResolvable(
  action: FinanceBudgetSuggestionAction,
  envelopeIds: Set<string>,
  categories: Set<string>,
) {
  if (action.kind === "set_limit") return envelopeIds.has(action.envelopeId);
  if (action.kind === "adjust_contribution") {
    return envelopeIds.has(action.envelopeId);
  }
  if (action.kind === "reallocate") {
    return (
      envelopeIds.has(action.fromEnvelopeId) &&
      envelopeIds.has(action.toEnvelopeId) &&
      action.fromEnvelopeId !== action.toEnvelopeId
    );
  }
  if (action.kind === "create_envelope") {
    // Without a target date there is nothing to divide the outstanding amount
    // over, so the fund could never state a required contribution.
    if (action.envelopeKind === "sinking" && !action.targetDate) return false;
    return action.categories.every((category) => categories.has(category));
  }
  return true;
}

export async function generateFinanceBudgetSuggestions(
  options: { now?: Date; replaceOpen?: boolean } = {},
) {
  await connectDB();
  const now = options.now ?? new Date();
  const snapshot = await getBudgetSnapshot(now);
  const [alerts, drafts, categoryDocs] = await Promise.all([
    listFinanceBudgetAlerts({ status: ["open", "acknowledged"] }),
    draftFinanceEnvelopes({ periods: HISTORY_PERIODS, now }),
    listFinanceCategories(),
  ]);
  const categories = categoryDocs.map((category) => category.name);
  const context = buildCoachContext({ snapshot, alerts, drafts, categories });

  const result = await generateJson<unknown>({
    purpose: "llm-api",
    source: "finance-budget-coach",
    temperature: 0.2,
    system: COACH_SYSTEM,
    user: JSON.stringify(context),
    logUserPrompt: JSON.stringify({
      currency: context.currency,
      envelopes: context.envelopes.length,
      unbudgetedCategories: context.unbudgetedCategories.length,
      openAlerts: context.openAlerts.length,
    }),
  });
  const parsed = parseCoachSuggestions(result.json);
  if (!parsed) {
    throw new Error("Could not parse budget suggestions");
  }
  if (parsed.rejected > 0) {
    console.warn("[finance] Dropped malformed budget suggestions", {
      rejected: parsed.rejected,
      accepted: parsed.suggestions.length,
    });
  }

  const envelopeIds = new Set(
    snapshot.envelopes.map((envelope) => envelope.id),
  );
  const categorySet = new Set([
    ...categories,
    ...snapshot.unbudgeted.flatMap((row) =>
      row.category ? [row.category] : [],
    ),
  ]);
  const suggestions = parsed.suggestions.flatMap((suggestion) => {
    const action = actionToWire(suggestion.action, snapshot.currency);
    if (!actionIsResolvable(action, envelopeIds, categorySet)) return [];
    return [
      {
        title: suggestion.title,
        rationale: suggestion.rationale,
        impactMinor:
          suggestion.impact === undefined
            ? undefined
            : toMinor(suggestion.impact, snapshot.currency),
        currency: snapshot.currency,
        action,
        status: "open" as const,
        generatedAt: now,
      },
    ];
  });

  // Regenerating replaces the standing set rather than layering a second one
  // on top: two contradictory proposals for the same envelope is not advice.
  if (options.replaceOpen !== false) {
    await FinanceBudgetSuggestion.updateMany(
      { status: "open" },
      { $set: { status: "dismissed", resolvedAt: now } },
    );
  }
  if (suggestions.length) {
    await FinanceBudgetSuggestion.insertMany(suggestions);
  }
  return listFinanceBudgetSuggestions({ status: ["open"] });
}

export class FinanceSuggestionApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinanceSuggestionApplyError";
  }
}

/**
 * Carries out the mechanical part of a suggestion.
 *
 * `reallocate` is the interesting one: moving money between envelopes means
 * lowering one limit and raising the other, and the two only cancel out when
 * both sides are expressed in their own cadence.
 */
async function applySuggestionAction(action: FinanceBudgetSuggestionAction) {
  if (action.kind === "advice") return;

  if (action.kind === "set_limit") {
    const updated = await updateFinanceEnvelope(action.envelopeId, {
      limitMinor: action.limitMinor,
    });
    if (!updated) throw new FinanceSuggestionApplyError("Envelope not found");
    return;
  }

  if (action.kind === "create_envelope") {
    await createFinanceEnvelope({
      name: action.name,
      kind: action.envelopeKind,
      categories: action.categories,
      includeUncategorized: false,
      limitMinor: action.limitMinor,
      period: action.period,
      periodStartDay: 1,
      rollover: action.rollover,
      targetDate: action.targetDate,
      status: "active",
    });
    return;
  }

  if (action.kind === "adjust_contribution") {
    // The required contribution is derived from target, saved and time left —
    // it is not a stored field, so the only honest way to act on "put more in"
    // is to actually put more in.
    const updated = await addFinanceEnvelopeContribution(action.envelopeId, {
      amountMinor: action.amountMinor,
      note: "Applied from a budget suggestion",
    });
    if (!updated) throw new FinanceSuggestionApplyError("Envelope not found");
    return;
  }

  const [from, to] = await Promise.all([
    getFinanceEnvelope(action.fromEnvelopeId),
    getFinanceEnvelope(action.toEnvelopeId),
  ]);
  if (!from || !to) {
    throw new FinanceSuggestionApplyError("Envelope not found");
  }
  if (from.limitMinor < action.amountMinor) {
    throw new FinanceSuggestionApplyError(
      `${from.name} does not have that much to give`,
    );
  }
  // The amount is stated in the source envelope's period. Moving it into a
  // different cadence has to preserve the *annual* sum, or funding a monthly
  // envelope out of a weekly one would quietly move four times what was asked.
  const inTargetPeriod = Math.round(
    (action.amountMinor * periodsPerYear(from.period)) /
      periodsPerYear(to.period),
  );
  await updateFinanceEnvelope(action.fromEnvelopeId, {
    limitMinor: from.limitMinor - action.amountMinor,
  });
  await updateFinanceEnvelope(action.toEnvelopeId, {
    limitMinor: to.limitMinor + inTargetPeriod,
  });
}

export async function decideFinanceBudgetSuggestion(
  id: string,
  action: "apply" | "dismiss",
  now = new Date(),
) {
  await connectDB();
  if (!mongoose.isValidObjectId(id)) return null;
  const suggestion = await FinanceBudgetSuggestion.findById(id);
  if (!suggestion) return null;
  if (suggestion.status !== "open") {
    throw new FinanceSuggestionApplyError(
      `Suggestion is already ${suggestion.status}`,
    );
  }
  if (action === "apply") {
    const wire = serializeFinanceBudgetSuggestion(suggestion);
    await applySuggestionAction(wire.action);
  }
  suggestion.status = action === "apply" ? "applied" : "dismissed";
  suggestion.resolvedAt = now;
  await suggestion.save();
  return serializeFinanceBudgetSuggestion(suggestion);
}
