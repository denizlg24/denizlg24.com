import type {
  FinanceBudgetAlertKind,
  FinanceBudgetAlertSeverity,
  FinanceEnvelopePeriod,
} from "@repo/schemas";
import {
  financeEnvelopeContributionInputSchema,
  financeEnvelopeInputSchema,
  financeEnvelopeUpdateSchema,
} from "@repo/schemas";
import type { ZodType } from "zod";
import { getFinanceBudgetOverview } from "@/lib/finance/budget";
import {
  decideFinanceBudgetAlert,
  evaluateFinanceBudgetAlerts,
  listFinanceBudgetAlerts,
} from "@/lib/finance/budget-alerts";
import {
  decideFinanceBudgetSuggestion,
  generateFinanceBudgetSuggestions,
  listFinanceBudgetSuggestions,
} from "@/lib/finance/budget-coach";
import {
  addFinanceEnvelopeContribution,
  createFinanceEnvelope,
  deleteFinanceEnvelope,
  draftFinanceEnvelopes,
  listFinanceEnvelopes,
  removeFinanceEnvelopeContribution,
  serializeFinanceEnvelope,
  updateFinanceEnvelope,
} from "@/lib/finance/envelopes";
import type { ToolDefinition } from "./types";

/**
 * Budgeting tools.
 *
 * Same money contract as the rest of finance: minor units, expenses negative,
 * no silent currency conversion. What is different is that every figure here
 * has already been converted into the base currency by `loadBudgetLedger`,
 * because a budget is a single plan and per-currency splits would make an
 * envelope unanswerable.
 *
 * Payloads are bounded the same way. `get_finance_budget` returns one line per
 * envelope and the open alerts, not the ledger behind them — that stays
 * reachable through `list_finance_entries`.
 */

const PERIOD_ENUM = ["weekly", "monthly", "quarterly", "yearly"] as const;
const ROLLOVER_ENUM = ["none", "surplus", "both"] as const;
const KIND_ENUM = ["capped", "sinking"] as const;
const ALERT_KIND_ENUM = [
  "envelope_exceeded",
  "envelope_projected_overspend",
  "envelope_pace",
  "unbudgeted_spend",
  "sinking_underfunded",
  "runway_low",
  "income_missed",
  "subscription_increase",
] as const;

function parse<T>(schema: ZodType<T>, input: unknown, label: string): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const where = issue?.path.length ? ` at ${issue.path.join(".")}` : "";
  throw new Error(`Invalid ${label}${where}: ${issue?.message ?? "unknown"}`);
}

function requireString(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${key} is required`);
  }
  return value;
}

/** One envelope reduced to the figures a model can act on. */
function envelopeLine(
  status: Awaited<
    ReturnType<typeof getFinanceBudgetOverview>
  >["statuses"][number],
) {
  const shared = {
    envelopeId: status.envelopeId,
    name: status.name,
    kind: status.kind,
    period: status.period,
    periodStart: status.periodStart,
    periodEnd: status.periodEnd,
    currency: status.currency,
    spentMinor: status.spentMinor,
    committedMinor: status.committedMinor,
    entryCount: status.entryCount,
  };
  if (status.kind === "sinking") {
    return {
      ...shared,
      targetMinor: status.limitMinor,
      savedMinor: status.savedMinor,
      requiredPerPeriodMinor: status.requiredPerPeriodMinor,
      periodsRemaining: status.periodsRemaining,
      onTrack: status.onTrack,
    };
  }
  return {
    ...shared,
    limitMinor: status.limitMinor,
    carryInMinor: status.carryInMinor,
    availableMinor: status.availableMinor,
    projectedMinor: status.projectedMinor,
    paceRatio: status.paceRatio,
    elapsedFraction: status.elapsedFraction,
  };
}

export const financeBudgetTools: ToolDefinition[] = [
  {
    schema: {
      name: "get_finance_budget",
      description:
        "The spending plan against reality: every envelope with what it has spent, what is left and whether it is on pace, the monthly roll-up, spend no envelope covers, and the open alerts. Does not include individual transactions — use list_finance_entries for those.",
      input_schema: { type: "object", properties: {} },
    },
    isWrite: false,
    category: "finance",
    execute: async () => {
      const overview = await getFinanceBudgetOverview();
      return {
        asOfDate: overview.asOfDate,
        currency: overview.currency,
        totals: overview.totals,
        envelopes: overview.statuses.map(envelopeLine),
        unbudgeted: overview.unbudgeted,
        alerts: overview.alerts.map((alert) => ({
          id: alert.id,
          kind: alert.kind,
          severity: alert.severity,
          status: alert.status,
          title: alert.title,
          detail: alert.detail,
          envelopeId: alert.envelopeId,
          category: alert.category,
        })),
        openSuggestions: overview.suggestions.length,
        // Rows no FX rate could convert are excluded from every total above.
        // Reporting them keeps a partial picture from reading as a complete one.
        unconvertedByCurrency: overview.unconvertedByCurrency,
      };
    },
  },
  {
    schema: {
      name: "list_finance_envelopes",
      description:
        "The envelope definitions themselves — categories, limits, cadence, rollover, sinking-fund contributions. For what has actually been spent against them use get_finance_budget.",
      input_schema: {
        type: "object",
        properties: {
          includeArchived: {
            type: "boolean",
            description: "Also return archived envelopes.",
          },
        },
      },
    },
    isWrite: false,
    category: "finance",
    execute: async (input) => {
      const envelopes = await listFinanceEnvelopes({
        includeArchived: input.includeArchived === true,
      });
      return { envelopes: envelopes.map(serializeFinanceEnvelope) };
    },
  },
  {
    schema: {
      name: "create_finance_envelope",
      description:
        "Add an envelope to the plan. A capped envelope limits spend in its categories each period; a sinking fund accumulates toward a target by a date and needs targetDate. A category may belong to only one active envelope — creating an overlapping one is refused.",
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Envelope name." },
          kind: {
            type: "string",
            description:
              "capped = a per-period spending limit. sinking = save toward a one-off by targetDate.",
            enum: [...KIND_ENUM],
          },
          categories: {
            type: "array",
            description:
              "Exact category names this envelope covers. Must already exist in the category catalog.",
            items: { type: "string" },
          },
          includeUncategorized: {
            type: "boolean",
            description:
              "Also claim rows with no category. At most one envelope may.",
          },
          limitMinor: {
            type: "number",
            description:
              "Per-period limit in minor units for capped, or the total target for sinking. Always positive.",
            minimum: 0,
          },
          period: {
            type: "string",
            description: "How often the limit resets.",
            enum: [...PERIOD_ENUM],
          },
          periodStartDay: {
            type: "number",
            description:
              "Day of the month the period starts on, 1-28, for aligning to payday. Ignored when weekly.",
            minimum: 1,
            maximum: 28,
          },
          rollover: {
            type: "string",
            description:
              "none = reset every period. surplus = carry what was left over. both = also carry an overspend.",
            enum: [...ROLLOVER_ENUM],
          },
          startDate: {
            type: "string",
            description:
              "YYYY-MM-DD. Anchors the period grid and floors the rollover history.",
          },
          targetDate: {
            type: "string",
            description: "YYYY-MM-DD. Required for a sinking fund.",
          },
          accountId: {
            type: "string",
            description: "Restrict the envelope to one account.",
          },
          notes: { type: "string", description: "Free text." },
        },
        required: ["name", "limitMinor"],
      },
    },
    isWrite: true,
    category: "finance",
    execute: async (input) => {
      const envelope = await createFinanceEnvelope(
        parse(financeEnvelopeInputSchema, input, "envelope"),
      );
      return serializeFinanceEnvelope(envelope);
    },
  },
  {
    schema: {
      name: "update_finance_envelope",
      description:
        "Change an envelope. Every field is optional; omitted fields keep their value. Set status to archived to retire one without losing its history.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Envelope id." },
          name: { type: "string", description: "Envelope name." },
          kind: { type: "string", enum: [...KIND_ENUM], description: "Kind." },
          categories: {
            type: "array",
            description: "Replaces the category list entirely.",
            items: { type: "string" },
          },
          includeUncategorized: {
            type: "boolean",
            description: "Claim rows with no category.",
          },
          limitMinor: {
            type: "number",
            description: "Per-period limit, or target for a sinking fund.",
            minimum: 0,
          },
          period: {
            type: "string",
            enum: [...PERIOD_ENUM],
            description: "Cadence.",
          },
          periodStartDay: {
            type: "number",
            description: "Period start day, 1-28.",
            minimum: 1,
            maximum: 28,
          },
          rollover: {
            type: "string",
            enum: [...ROLLOVER_ENUM],
            description: "Carry behaviour.",
          },
          startDate: { type: "string", description: "YYYY-MM-DD." },
          targetDate: { type: "string", description: "YYYY-MM-DD." },
          status: {
            type: "string",
            description: "active or archived.",
            enum: ["active", "archived"],
          },
          notes: { type: "string", description: "Free text." },
        },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "finance",
    execute: async (input) => {
      const { id, ...rest } = input;
      const envelope = await updateFinanceEnvelope(
        requireString(input, "id"),
        parse(financeEnvelopeUpdateSchema, rest, "envelope"),
      );
      if (!envelope) throw new Error("Envelope not found");
      return serializeFinanceEnvelope(envelope);
    },
  },
  {
    schema: {
      name: "delete_finance_envelope",
      description:
        "Permanently remove an envelope and its contribution history. Prefer archiving through update_finance_envelope, which keeps the record.",
      input_schema: {
        type: "object",
        properties: { id: { type: "string", description: "Envelope id." } },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "finance",
    execute: async (input) => {
      const deleted = await deleteFinanceEnvelope(requireString(input, "id"));
      if (!deleted) throw new Error("Envelope not found");
      return { success: true };
    },
  },
  {
    schema: {
      name: "contribute_to_finance_envelope",
      description:
        "Record money set aside into a sinking fund. Setting money aside is not a bank transaction, so nothing observes it automatically. A negative amount withdraws from the fund without recording an expense.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Sinking fund envelope id." },
          amountMinor: {
            type: "number",
            description:
              "Minor units. Positive adds to the fund, negative takes back out.",
          },
          date: {
            type: "string",
            description: "YYYY-MM-DD. Defaults to today.",
          },
          note: { type: "string", description: "Free text." },
        },
        required: ["id", "amountMinor"],
      },
    },
    isWrite: true,
    category: "finance",
    execute: async (input) => {
      const { id, ...rest } = input;
      const envelope = await addFinanceEnvelopeContribution(
        requireString(input, "id"),
        parse(financeEnvelopeContributionInputSchema, rest, "contribution"),
      );
      if (!envelope) throw new Error("Envelope not found");
      return serializeFinanceEnvelope(envelope);
    },
  },
  {
    schema: {
      name: "remove_finance_envelope_contribution",
      description: "Delete one recorded contribution from a sinking fund.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Envelope id." },
          contributionId: {
            type: "string",
            description: "Contribution id.",
          },
        },
        required: ["id", "contributionId"],
      },
    },
    isWrite: true,
    category: "finance",
    execute: async (input) => {
      const envelope = await removeFinanceEnvelopeContribution(
        requireString(input, "id"),
        requireString(input, "contributionId"),
      );
      if (!envelope) throw new Error("Contribution not found");
      return serializeFinanceEnvelope(envelope);
    },
  },
  {
    schema: {
      name: "draft_finance_envelopes",
      description:
        "Propose starting limits for categories that have no envelope, from spending history alone. Uses the median of recent periods rather than the mean, so one unusual month does not set a limit nothing can breach. Reads only — nothing is created.",
      input_schema: {
        type: "object",
        properties: {
          period: {
            type: "string",
            description: "Cadence to measure over. Defaults to monthly.",
            enum: [...PERIOD_ENUM],
          },
          periods: {
            type: "number",
            description: "How many completed periods to look back, 2-24.",
            minimum: 2,
            maximum: 24,
          },
          headroomPercent: {
            type: "number",
            description:
              "Percentage added to the median to set the suggested limit. Defaults to 10.",
            minimum: 0,
            maximum: 100,
          },
        },
      },
    },
    isWrite: false,
    category: "finance",
    execute: async (input) => ({
      drafts: await draftFinanceEnvelopes({
        period: input.period as FinanceEnvelopePeriod | undefined,
        periods: input.periods as number | undefined,
        headroomPercent: input.headroomPercent as number | undefined,
      }),
    }),
  },
  {
    schema: {
      name: "list_finance_budget_alerts",
      description:
        "Budget alerts. These are derived from the ledger on every finance cron run, not written by hand: an alert that no longer holds is resolved automatically, so an open one is currently true.",
      input_schema: {
        type: "object",
        properties: {
          status: {
            type: "array",
            description:
              "Defaults to open only. acknowledged means seen and suppressed; resolved means it stopped being true.",
            items: { type: "string" },
          },
          severity: {
            type: "array",
            description: "info, warning or critical.",
            items: { type: "string" },
          },
          kind: {
            type: "array",
            description: `Restrict to alert kinds: ${ALERT_KIND_ENUM.join(", ")}.`,
            items: { type: "string" },
          },
          limit: {
            type: "number",
            description: "Rows to return, 1-200 (default 100).",
            minimum: 1,
            maximum: 200,
          },
        },
      },
    },
    isWrite: false,
    category: "finance",
    execute: async (input) => ({
      alerts: await listFinanceBudgetAlerts({
        status: input.status as
          | Array<"open" | "acknowledged" | "resolved">
          | undefined,
        severity: input.severity as FinanceBudgetAlertSeverity[] | undefined,
        kind: input.kind as FinanceBudgetAlertKind[] | undefined,
        limit: input.limit as number | undefined,
      }),
    }),
  },
  {
    schema: {
      name: "evaluate_finance_budget_alerts",
      description:
        "Re-derive the alert set from the current ledger instead of waiting for the finance cron. Idempotent: it updates the existing rows rather than adding duplicates, and resolves any that no longer hold.",
      input_schema: { type: "object", properties: {} },
    },
    isWrite: true,
    category: "finance",
    execute: async () => {
      const result = await evaluateFinanceBudgetAlerts();
      return {
        evaluatedAt: result.evaluatedAt,
        opened: result.opened,
        updated: result.updated,
        reopened: result.reopened,
        resolved: result.resolved,
        alerts: result.alerts.map((alert) => ({
          id: alert.id,
          kind: alert.kind,
          severity: alert.severity,
          title: alert.title,
        })),
      };
    },
  },
  {
    schema: {
      name: "resolve_finance_budget_alert",
      description:
        "Act on one alert. acknowledge suppresses it without deleting it — a condition that later gets worse reopens it anyway. resolve closes it outright; reopen undoes either.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Alert id." },
          action: {
            type: "string",
            description: "What to do with it.",
            enum: ["acknowledge", "reopen", "resolve"],
          },
        },
        required: ["id", "action"],
      },
    },
    isWrite: true,
    category: "finance",
    execute: async (input) => {
      const action = requireString(input, "action");
      if (
        action !== "acknowledge" &&
        action !== "reopen" &&
        action !== "resolve"
      ) {
        throw new Error("action must be acknowledge, reopen or resolve");
      }
      const alert = await decideFinanceBudgetAlert(
        requireString(input, "id"),
        action,
      );
      if (!alert) throw new Error("Alert not found");
      return alert;
    },
  },
  {
    schema: {
      name: "list_finance_budget_suggestions",
      description:
        "Standing budget suggestions. Each one carries an action that can be applied mechanically, or is explicitly advice with nothing to apply.",
      input_schema: {
        type: "object",
        properties: {
          status: {
            type: "array",
            description: "Defaults to open. Also applied or dismissed.",
            items: { type: "string" },
          },
        },
      },
    },
    isWrite: false,
    category: "finance",
    execute: async (input) => ({
      suggestions: await listFinanceBudgetSuggestions({
        status: input.status as
          | Array<"open" | "applied" | "dismissed">
          | undefined,
      }),
    }),
  },
  {
    schema: {
      name: "generate_finance_budget_suggestions",
      description:
        "Produce a fresh set of budget suggestions from envelope status, category history and open alerts. This makes a model call and replaces the standing open set, so do not run it to read the existing suggestions — use list_finance_budget_suggestions.",
      input_schema: { type: "object", properties: {} },
    },
    isWrite: true,
    category: "finance",
    execute: async () => ({
      suggestions: await generateFinanceBudgetSuggestions(),
    }),
  },
  {
    schema: {
      name: "resolve_finance_budget_suggestion",
      description:
        "Apply a suggestion — which really changes the envelope it names — or dismiss it. Applying advice, which has no action, only marks it done.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Suggestion id." },
          action: {
            type: "string",
            description: "apply carries out the change; dismiss discards it.",
            enum: ["apply", "dismiss"],
          },
        },
        required: ["id", "action"],
      },
    },
    isWrite: true,
    category: "finance",
    execute: async (input) => {
      const action = requireString(input, "action");
      if (action !== "apply" && action !== "dismiss") {
        throw new Error("action must be apply or dismiss");
      }
      const suggestion = await decideFinanceBudgetSuggestion(
        requireString(input, "id"),
        action,
      );
      if (!suggestion) throw new Error("Suggestion not found");
      return suggestion;
    },
  },
];
