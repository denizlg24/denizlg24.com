import {
  financeAccountSettingsInputSchema,
  financeCategoryInputSchema,
  financeCsvImportInputSchema,
  financeExpectedEntryInputSchema,
  financeFxSnapshotSchema,
  financeLedgerEntryUpdateSchema,
  financeManualEntryInputSchema,
  financeNaturalEntryInputSchema,
  financeRecurringRuleInputSchema,
  financeSettingsInputSchema,
} from "@repo/schemas";
import type { ZodType } from "zod";
import {
  disconnectFinanceAccount,
  FinanceBudgetReserveError,
  listFinanceAccounts,
  updateFinanceAccountSettings,
} from "@/lib/finance/accounts";
import {
  createFinanceCategory,
  deleteFinanceCategory,
  listFinanceCategories,
  updateFinanceCategory,
} from "@/lib/finance/categories";
import {
  getFinanceDashboard,
  serializeFinanceAccount,
  serializeFinanceCategory,
  serializeFinanceLedgerEntry,
  serializeFinanceRecurringRule,
} from "@/lib/finance/dashboard";
import { refreshFinanceFxRates } from "@/lib/finance/fx";
import {
  createExpectedFinanceEntry,
  createManualFinanceEntry,
  deleteFinanceLedgerEntry,
  linkFinanceLedgerEntries,
  resolveFinanceMatchReview,
  unlinkFinanceLedgerEntry,
  updateFinanceLedgerEntry,
} from "@/lib/finance/ledger";
import {
  createFinanceNarrative,
  createNaturalFinanceEntry,
  importFinanceCsv,
  upsertFinanceFxSnapshot,
} from "@/lib/finance/operations";
import {
  type FinanceLedgerState,
  getFinanceLedgerEntry,
  listFinanceMatchReviews,
  queryFinanceLedger,
  summarizeFinanceByCategory,
} from "@/lib/finance/queries";
import {
  createFinanceRecurringRule,
  deleteFinanceRecurringRule,
  listFinanceRecurringRules,
  updateFinanceRecurringRule,
} from "@/lib/finance/rules";
import {
  getFinanceSettings,
  serializeFinanceSettings,
  updateFinanceSettings,
} from "@/lib/finance/settings";
import { syncFinanceAccount } from "@/lib/finance/sync";
import type { ToolDefinition } from "./types";

/**
 * Money is always minor units (cents) and an expense is a negative amount.
 * Nothing here converts between currencies: FX conversion happens against a
 * dated snapshot and a total that silently mixes currencies is worse than one
 * the caller can see is split, so per-currency figures stay split.
 *
 * Payloads are bounded. `getFinanceDashboard` returns every ledger row in a
 * 400-day window plus up to 2,000 FX snapshots because the admin UI charts
 * them; `get_finance_overview` reduces that to the figures a model can act on
 * and the ledger is reached through `list_finance_entries` instead.
 */

const DIRECTION_ENUM = ["expense", "income"] as const;

/**
 * Validates through the canonical schema and reports the first failure with
 * its field path, so a rejected call tells the caller what to fix rather than
 * just that something was wrong.
 */
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

export const financeTools: ToolDefinition[] = [
  {
    schema: {
      name: "get_finance_overview",
      description:
        "Current financial position: accounts with their connection state and fetch budget, balances, month-to-date spend and income, the cash-flow forecast, pending match reviews and the category catalog. Does not include individual transactions — use list_finance_entries for those.",
      input_schema: { type: "object", properties: {} },
    },
    isWrite: false,
    category: "finance",
    execute: async () => {
      const dashboard = await getFinanceDashboard();
      return {
        accounts: dashboard.accounts.map((account) => ({
          id: account.id,
          displayName: account.displayName,
          institutionName: account.institutionName,
          currency: account.currency,
          status: account.connection.status,
          accessValidUntil: account.connection.accessValidUntil,
          fetchesUsed: account.budget.fetchesUsed,
          dailyFetchLimit: account.budget.dailyFetchLimit,
          nextSyncAt: account.budget.nextSyncAt,
          lastSyncedAt: account.lastSyncedAt,
        })),
        balances: dashboard.balances.map((balance) => ({
          accountId: balance.accountId,
          balanceType: balance.balanceType,
          amountMinor: balance.amountMinor,
          currency: balance.currency,
          referenceDate: balance.referenceDate,
        })),
        aggregateBalances: dashboard.aggregateBalances,
        monthly: dashboard.monthly,
        forecast: dashboard.forecast,
        // Counts only: the rows themselves are reachable through
        // list_finance_match_reviews and list_finance_rules.
        pendingMatchReviews: dashboard.matchReviews.length,
        recurringRules: dashboard.recurringRules.length,
        recurringCandidates: dashboard.recurringCandidates.length,
        ledgerRowsInWindow: dashboard.ledger.length,
        categories: dashboard.categories.map((category) => category.name),
        settings: dashboard.settings,
      };
    },
  },
  {
    schema: {
      name: "list_finance_entries",
      description:
        "Query the ledger. Amounts are minor units and expenses are negative. Returns at most 100 rows; narrow with filters and page with offset rather than raising the limit.",
      input_schema: {
        type: "object",
        properties: {
          accountId: {
            type: "string",
            description: "Restrict to one account.",
          },
          origin: {
            type: "string",
            description:
              "bank = synced from the provider, manual = entered by hand, projected = produced by a recurring rule or an expected entry.",
            enum: ["bank", "manual", "projected"],
          },
          state: {
            type: "string",
            description:
              "Row state. bank: pending|booked|void. manual: active|linked|void. projected: expected|linked|missed|void.",
          },
          direction: {
            type: "string",
            description: "Filter to expenses or income.",
            enum: [...DIRECTION_ENUM],
          },
          category: { type: "string", description: "Exact category name." },
          uncategorized: {
            type: "boolean",
            description: "Only rows with no category. Overrides category.",
          },
          from: { type: "string", description: "Earliest date, YYYY-MM-DD." },
          to: { type: "string", description: "Latest date, YYYY-MM-DD." },
          search: {
            type: "string",
            description: "Case-insensitive substring of the descriptor.",
          },
          minAmountMinor: {
            type: "number",
            description: "Smallest absolute amount in minor units.",
            minimum: 0,
          },
          maxAmountMinor: {
            type: "number",
            description: "Largest absolute amount in minor units.",
            minimum: 0,
          },
          limit: {
            type: "number",
            description: "Rows to return, 1-100 (default 25).",
            minimum: 1,
            maximum: 100,
          },
          offset: { type: "number", description: "Rows to skip.", minimum: 0 },
        },
      },
    },
    isWrite: false,
    category: "finance",
    execute: async (input) => {
      const result = await queryFinanceLedger({
        accountId: input.accountId as string | undefined,
        origin: input.origin as "bank" | "manual" | "projected" | undefined,
        state: input.state as FinanceLedgerState | undefined,
        direction: input.direction as "expense" | "income" | undefined,
        category: input.category as string | undefined,
        uncategorized: input.uncategorized === true,
        from: input.from as string | undefined,
        to: input.to as string | undefined,
        search: input.search as string | undefined,
        minAmountMinor: input.minAmountMinor as number | undefined,
        maxAmountMinor: input.maxAmountMinor as number | undefined,
        limit: input.limit as number | undefined,
        offset: input.offset as number | undefined,
      });
      return {
        entries: result.rows.map(serializeFinanceLedgerEntry),
        total: result.total,
        limit: result.limit,
        offset: result.offset,
        hasMore: result.offset + result.rows.length < result.total,
      };
    },
  },
  {
    schema: {
      name: "get_finance_entry",
      description: "Read one ledger entry in full by its id.",
      input_schema: {
        type: "object",
        properties: { id: { type: "string", description: "Ledger entry id." } },
        required: ["id"],
      },
    },
    isWrite: false,
    category: "finance",
    execute: async (input) => {
      const entry = await getFinanceLedgerEntry(requireString(input, "id"));
      if (!entry) throw new Error("Ledger entry not found");
      return serializeFinanceLedgerEntry(entry);
    },
  },
  {
    schema: {
      name: "summarize_finance_spend",
      description:
        "Totals grouped by category over a date range. Spend and income are reported separately per currency, never netted into one figure and never converted between currencies.",
      input_schema: {
        type: "object",
        properties: {
          from: { type: "string", description: "Start date, YYYY-MM-DD." },
          to: { type: "string", description: "End date, YYYY-MM-DD." },
          accountId: {
            type: "string",
            description: "Restrict to one account.",
          },
        },
        required: ["from", "to"],
      },
    },
    isWrite: false,
    category: "finance",
    execute: async (input) =>
      summarizeFinanceByCategory({
        from: requireString(input, "from"),
        to: requireString(input, "to"),
        accountId: input.accountId as string | undefined,
      }),
  },
  {
    schema: {
      name: "create_finance_entry",
      description:
        "Record a transaction by hand against an account. Give the amount as a positive number of minor units and set direction; the ledger applies the sign.",
      input_schema: {
        type: "object",
        properties: {
          accountId: { type: "string", description: "Account id." },
          amountMinor: {
            type: "number",
            description: "Positive amount in minor units (cents).",
            minimum: 1,
          },
          currency: {
            type: "string",
            description: "ISO 4217 code, e.g. EUR.",
          },
          direction: {
            type: "string",
            description: "Defaults to expense.",
            enum: [...DIRECTION_ENUM],
          },
          effectiveDate: { type: "string", description: "Date, YYYY-MM-DD." },
          descriptor: {
            type: "string",
            description: "What the transaction was.",
          },
          note: { type: "string", description: "Free-text note." },
        },
        required: [
          "accountId",
          "amountMinor",
          "currency",
          "effectiveDate",
          "descriptor",
        ],
      },
    },
    isWrite: true,
    category: "finance",
    execute: async (input) => {
      const entry = await createManualFinanceEntry(
        parse(financeManualEntryInputSchema, input, "manual entry"),
      );
      if (!entry) throw new Error("Account not found");
      return serializeFinanceLedgerEntry(entry);
    },
  },
  {
    schema: {
      name: "create_finance_entry_from_text",
      description:
        "Record a transaction from a natural-language description such as '12.40 lunch at the canteen yesterday'. The amount, date and descriptor are extracted by a model; prefer create_finance_entry when the figures are already known.",
      input_schema: {
        type: "object",
        properties: {
          accountId: { type: "string", description: "Account id." },
          text: {
            type: "string",
            description: "The transaction described in plain language.",
          },
        },
        required: ["accountId", "text"],
      },
    },
    isWrite: true,
    category: "finance",
    execute: async (input) =>
      createNaturalFinanceEntry(
        parse(financeNaturalEntryInputSchema, input, "natural entry"),
      ),
  },
  {
    schema: {
      name: "create_expected_finance_entry",
      description:
        "Record a transaction that has not happened yet — a booked flight, an invoice due — so it appears in the forecast. A real transaction landing within matchWindowDays reconciles against it automatically.",
      input_schema: {
        type: "object",
        properties: {
          accountId: { type: "string", description: "Account id." },
          amountMinor: {
            type: "number",
            description: "Positive amount in minor units.",
            minimum: 1,
          },
          currency: { type: "string", description: "ISO 4217 code." },
          direction: {
            type: "string",
            description: "Defaults to expense.",
            enum: [...DIRECTION_ENUM],
          },
          effectiveDate: {
            type: "string",
            description: "Date it is expected, YYYY-MM-DD.",
          },
          descriptor: { type: "string", description: "What is expected." },
          category: { type: "string", description: "Category name." },
          matchWindowDays: {
            type: "number",
            description:
              "Days either side a real transaction may land and still match (default 5).",
            minimum: 0,
            maximum: 60,
          },
        },
        required: [
          "accountId",
          "amountMinor",
          "currency",
          "effectiveDate",
          "descriptor",
        ],
      },
    },
    isWrite: true,
    category: "finance",
    execute: async (input) => {
      const entry = await createExpectedFinanceEntry(
        parse(financeExpectedEntryInputSchema, input, "expected entry"),
      );
      if (!entry) throw new Error("Account not found");
      return serializeFinanceLedgerEntry(entry);
    },
  },
  {
    schema: {
      name: "update_finance_entry",
      description:
        "Change a ledger entry. Pass category or note as null to clear it. Setting applyToMerchant also categorizes the merchant, so sibling and future rows follow.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Ledger entry id." },
          category: {
            type: "string",
            description: "New category name, or null to clear.",
          },
          descriptor: { type: "string", description: "New descriptor." },
          note: { type: "string", description: "New note, or null to clear." },
          amountMinor: {
            type: "number",
            description: "New positive magnitude in minor units.",
            minimum: 1,
          },
          direction: {
            type: "string",
            description: "New direction.",
            enum: [...DIRECTION_ENUM],
          },
          effectiveDate: {
            type: "string",
            description: "New date, YYYY-MM-DD.",
          },
          applyToMerchant: {
            type: "boolean",
            description:
              "Also categorize the merchant so sibling and future rows follow.",
          },
        },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "finance",
    execute: async (input) => {
      const { id, ...patch } = input;
      const entry = await updateFinanceLedgerEntry(
        requireString({ id }, "id"),
        parse(financeLedgerEntryUpdateSchema, patch, "entry update"),
      );
      if (!entry) throw new Error("Ledger entry not found");
      return serializeFinanceLedgerEntry(entry);
    },
  },
  {
    schema: {
      name: "delete_finance_entry",
      description:
        "Delete a ledger entry. Only manually entered and projected rows can be deleted — a bank row would reappear on the next sync.",
      input_schema: {
        type: "object",
        properties: { id: { type: "string", description: "Ledger entry id." } },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "finance",
    execute: async (input) => {
      const deleted = await deleteFinanceLedgerEntry(
        requireString(input, "id"),
      );
      if (!deleted) throw new Error("Ledger entry not found");
      return { success: true };
    },
  },
  {
    schema: {
      name: "link_finance_entries",
      description:
        "Reconcile a manual or expected entry against the bank row that settled it, so the pair counts once.",
      input_schema: {
        type: "object",
        properties: {
          entryId: {
            type: "string",
            description: "The manual or projected entry.",
          },
          bankLedgerId: {
            type: "string",
            description: "The bank row that settled it.",
          },
        },
        required: ["entryId", "bankLedgerId"],
      },
    },
    isWrite: true,
    category: "finance",
    execute: async (input) => {
      const linked = await linkFinanceLedgerEntries(
        requireString(input, "entryId"),
        requireString(input, "bankLedgerId"),
      );
      if (!linked) throw new Error("Entries could not be linked");
      return { success: true };
    },
  },
  {
    schema: {
      name: "unlink_finance_entry",
      description: "Undo a reconciliation, returning both rows to the book.",
      input_schema: {
        type: "object",
        properties: {
          entryId: { type: "string", description: "The linked entry id." },
        },
        required: ["entryId"],
      },
    },
    isWrite: true,
    category: "finance",
    execute: async (input) => {
      const unlinked = await unlinkFinanceLedgerEntry(
        requireString(input, "entryId"),
      );
      if (!unlinked) throw new Error("Entry is not linked");
      return { success: true };
    },
  },
  {
    schema: {
      name: "list_finance_match_reviews",
      description:
        "Reconciliation candidates the matcher was not confident enough to apply on its own.",
      input_schema: {
        type: "object",
        properties: {
          status: {
            type: "string",
            description: "Defaults to pending.",
            enum: ["pending", "accepted", "rejected"],
          },
        },
      },
    },
    isWrite: false,
    category: "finance",
    execute: async (input) => {
      const reviews = await listFinanceMatchReviews(
        (input.status as "pending" | "accepted" | "rejected") ?? "pending",
      );
      return {
        reviews: reviews.map((review) => ({
          id: review._id.toString(),
          sourceLedgerId: review.sourceLedgerId.toString(),
          candidateBankLedgerId: review.candidateBankLedgerId.toString(),
          confidence: review.confidence,
          status: review.status,
          createdAt: review.createdAt.toISOString(),
        })),
      };
    },
  },
  {
    schema: {
      name: "resolve_finance_match_review",
      description:
        "Decide a pending reconciliation candidate: accept links the pair, reject leaves both rows separate and stops the matcher re-proposing it, unlink undoes an accepted one.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Match review id." },
          action: {
            type: "string",
            description: "The decision.",
            enum: ["accept", "reject", "unlink"],
          },
        },
        required: ["id", "action"],
      },
    },
    isWrite: true,
    category: "finance",
    execute: async (input) => {
      const action = input.action;
      if (action !== "accept" && action !== "reject" && action !== "unlink") {
        throw new Error("action must be accept, reject or unlink");
      }
      const resolved = await resolveFinanceMatchReview(
        requireString(input, "id"),
        action,
      );
      if (!resolved) throw new Error("Match review not found");
      return { success: true, action };
    },
  },
  {
    schema: {
      name: "list_finance_accounts",
      description:
        "Connected accounts with their connection state and daily fetch budget.",
      input_schema: { type: "object", properties: {} },
    },
    isWrite: false,
    category: "finance",
    execute: async () => {
      const accounts = await listFinanceAccounts();
      return { accounts: accounts.map(serializeFinanceAccount) };
    },
  },
  {
    schema: {
      name: "update_finance_account",
      description:
        "Change an account's display name or its provider fetch budget. The manual reserve must stay below the daily limit; raise both in one call if you need to.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Account id." },
          displayName: { type: "string", description: "New display name." },
          dailyFetchLimit: {
            type: "number",
            description: "Provider calls allowed per day.",
            minimum: 1,
          },
          reservedManualFetches: {
            type: "number",
            description:
              "Calls held back from the scheduler for attended syncs.",
            minimum: 0,
          },
          budgetTimezone: {
            type: "string",
            description: "IANA zone the daily budget window resets in.",
          },
          countsFailedAttempts: {
            type: "boolean",
            description: "Charge failed provider calls against the budget.",
          },
          attendedCallsExempt: {
            type: "boolean",
            description: "Exempt attended syncs from the budget entirely.",
          },
        },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "finance",
    execute: async (input) => {
      const { id, ...patch } = input;
      try {
        const account = await updateFinanceAccountSettings(
          requireString({ id }, "id"),
          parse(financeAccountSettingsInputSchema, patch, "account settings"),
        );
        if (!account) throw new Error("Account not found");
        return serializeFinanceAccount(account);
      } catch (error) {
        if (error instanceof FinanceBudgetReserveError) {
          throw new Error(error.message);
        }
        throw error;
      }
    },
  },
  {
    schema: {
      name: "sync_finance_account",
      description:
        "Fetch new transactions and balances for one account from its provider. This spends from the account's daily fetch budget, so do not call it speculatively.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Account id." },
        },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "finance",
    execute: async (input) =>
      // "cron", not "manual": the manual reserve exists so the owner can always
      // sync by hand, and `attendedCallsExempt` uncaps a manual sync entirely.
      // An agent turn — a scheduled task especially — is not a person at the
      // keyboard, so it stays behind the reserve.
      syncFinanceAccount(requireString(input, "id"), { mode: "cron" }),
  },
  {
    schema: {
      name: "disconnect_finance_account",
      description:
        "Drop an account's provider session. Ledger history is kept; only the connection ends.",
      input_schema: {
        type: "object",
        properties: { id: { type: "string", description: "Account id." } },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "finance",
    execute: async (input) => {
      const account = await disconnectFinanceAccount(
        requireString(input, "id"),
      );
      if (!account) throw new Error("Account not found");
      return { success: true };
    },
  },
  {
    schema: {
      name: "list_finance_categories",
      description: "The category catalog.",
      input_schema: { type: "object", properties: {} },
    },
    isWrite: false,
    category: "finance",
    execute: async () => {
      const categories = await listFinanceCategories();
      return { categories: categories.map(serializeFinanceCategory) };
    },
  },
  {
    schema: {
      name: "create_finance_category",
      description: "Add a category to the catalog.",
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Category name." },
          color: { type: "string", description: "Hex colour, e.g. #33aa77." },
          sortOrder: {
            type: "number",
            description: "Position in the catalog.",
          },
        },
        required: ["name"],
      },
    },
    isWrite: true,
    category: "finance",
    execute: async (input) => {
      const category = await createFinanceCategory(
        parse(financeCategoryInputSchema, input, "category"),
      );
      return serializeFinanceCategory(category);
    },
  },
  {
    schema: {
      name: "update_finance_category",
      description:
        "Rename or restyle a category. A rename cascades to every ledger row and merchant carrying the old name.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Category id." },
          name: { type: "string", description: "New name." },
          color: { type: "string", description: "New hex colour." },
          sortOrder: { type: "number", description: "New position." },
        },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "finance",
    execute: async (input) => {
      const { id, ...patch } = input;
      const category = await updateFinanceCategory(
        requireString({ id }, "id"),
        parse(financeCategoryInputSchema.partial(), patch, "category"),
      );
      if (!category) throw new Error("Category not found");
      return serializeFinanceCategory(category);
    },
  },
  {
    schema: {
      name: "delete_finance_category",
      description:
        "Remove a category. Rows carrying it move to reassignTo, or become uncategorized when it is omitted.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Category id." },
          reassignTo: {
            type: "string",
            description: "Existing category name to move affected rows to.",
          },
        },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "finance",
    execute: async (input) => {
      const result = await deleteFinanceCategory(requireString(input, "id"), {
        reassignTo: input.reassignTo as string | undefined,
      });
      if (!result) throw new Error("Category not found");
      return { success: true, ...result };
    },
  },
  {
    schema: {
      name: "list_finance_rules",
      description:
        "Recurring rules — the salaries, rents and subscriptions that project expected entries into the forecast.",
      input_schema: { type: "object", properties: {} },
    },
    isWrite: false,
    category: "finance",
    execute: async () => {
      const rules = await listFinanceRecurringRules();
      return { rules: rules.map(serializeFinanceRecurringRule) };
    },
  },
  {
    schema: {
      name: "create_finance_rule",
      description:
        "Create a recurring rule and project its expected entries. amountKind fixed means the amount is known; variable means only the cadence is, and matchTolerancePercent decides how far a real transaction may differ and still match.",
      input_schema: {
        type: "object",
        properties: {
          accountId: { type: "string", description: "Account id." },
          name: { type: "string", description: "Rule name, e.g. Rent." },
          direction: {
            type: "string",
            description: "expense or income.",
            enum: [...DIRECTION_ENUM],
          },
          amountKind: {
            type: "string",
            description: "fixed when the amount is known, otherwise variable.",
            enum: ["fixed", "variable"],
          },
          amountMinor: {
            type: "number",
            description: "Expected amount in minor units.",
            minimum: 0,
          },
          currency: { type: "string", description: "ISO 4217 code." },
          recurrence: {
            type: "object",
            description:
              "One of: {cadence:'daily',interval}, {cadence:'weekly',interval,weekday:0-6}, {cadence:'semiMonthly',firstDay,secondDay}, {cadence:'monthly',interval,dayOfMonth}, {cadence:'yearly',interval,month,dayOfMonth}.",
          },
          anchorDate: {
            type: "string",
            description: "First occurrence, YYYY-MM-DD.",
          },
          matchTolerancePercent: {
            type: "number",
            description: "How far a real amount may differ and still match.",
            minimum: 0,
            maximum: 100,
          },
          matchWindowDays: {
            type: "number",
            description: "Days either side of the due date that still match.",
            minimum: 0,
          },
          status: {
            type: "string",
            description: "active or paused (default active).",
            enum: ["active", "paused"],
          },
          endDate: {
            type: "string",
            description: "Last date the rule applies, YYYY-MM-DD.",
          },
        },
        required: [
          "accountId",
          "name",
          "direction",
          "amountKind",
          "amountMinor",
          "currency",
          "recurrence",
          "anchorDate",
          "matchTolerancePercent",
          "matchWindowDays",
          "status",
        ],
      },
    },
    isWrite: true,
    category: "finance",
    execute: async (input) => {
      const rule = await createFinanceRecurringRule(
        parse(financeRecurringRuleInputSchema, input, "recurring rule"),
      );
      if (!rule) throw new Error("Failed to create recurring rule");
      return serializeFinanceRecurringRule(rule);
    },
  },
  {
    schema: {
      name: "update_finance_rule",
      description:
        "Change a recurring rule and re-project its expected entries. Set status to paused to stop it projecting without losing it.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Rule id." },
          name: { type: "string", description: "New name." },
          direction: {
            type: "string",
            description: "New direction.",
            enum: [...DIRECTION_ENUM],
          },
          amountKind: {
            type: "string",
            description: "New amount kind.",
            enum: ["fixed", "variable"],
          },
          amountMinor: {
            type: "number",
            description: "New amount in minor units.",
            minimum: 0,
          },
          currency: { type: "string", description: "New ISO 4217 code." },
          recurrence: {
            type: "object",
            description: "New recurrence, same shape as create_finance_rule.",
          },
          anchorDate: { type: "string", description: "New anchor date." },
          matchTolerancePercent: {
            type: "number",
            description: "New tolerance.",
            minimum: 0,
            maximum: 100,
          },
          matchWindowDays: {
            type: "number",
            description: "New match window.",
            minimum: 0,
          },
          status: {
            type: "string",
            description: "active or paused.",
            enum: ["active", "paused"],
          },
          endDate: { type: "string", description: "New end date." },
        },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "finance",
    execute: async (input) => {
      const { id, ...patch } = input;
      const rule = await updateFinanceRecurringRule(
        requireString({ id }, "id"),
        parse(
          financeRecurringRuleInputSchema.partial(),
          patch,
          "recurring rule",
        ),
      );
      if (!rule) throw new Error("Rule not found");
      return serializeFinanceRecurringRule(rule);
    },
  },
  {
    schema: {
      name: "delete_finance_rule",
      description:
        "Delete a recurring rule. The entries it projected are voided rather than removed, so anything a real transaction already matched stays intact.",
      input_schema: {
        type: "object",
        properties: { id: { type: "string", description: "Rule id." } },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "finance",
    execute: async (input) => {
      const rule = await deleteFinanceRecurringRule(requireString(input, "id"));
      if (!rule) throw new Error("Rule not found");
      return { success: true };
    },
  },
  {
    schema: {
      name: "get_finance_settings",
      description:
        "Base currency and FX source. The base currency is what aggregate balances and the forecast are expressed in.",
      input_schema: { type: "object", properties: {} },
    },
    isWrite: false,
    category: "finance",
    execute: async () => serializeFinanceSettings(await getFinanceSettings()),
  },
  {
    schema: {
      name: "update_finance_settings",
      description:
        "Change the base currency or the FX source. Changing the base currency re-expresses every aggregate, so confirm it is intended.",
      input_schema: {
        type: "object",
        properties: {
          baseCurrency: {
            type: "string",
            description: "ISO 4217 code to express aggregates in.",
          },
          fxSource: { type: "string", description: "FX rate source." },
        },
      },
    },
    isWrite: true,
    category: "finance",
    execute: async (input) => {
      const settings = await updateFinanceSettings(
        parse(financeSettingsInputSchema, input, "finance settings"),
      );
      return serializeFinanceSettings(settings);
    },
  },
  {
    schema: {
      name: "refresh_finance_fx",
      description:
        "Fetch current FX rates for every currency in use. Conversion reads dated snapshots, so aggregates stay stale until this runs.",
      input_schema: { type: "object", properties: {} },
    },
    isWrite: true,
    category: "finance",
    execute: async () => refreshFinanceFxRates(),
  },
  {
    schema: {
      name: "set_finance_fx_rate",
      description:
        "Record one FX rate by hand, for a pair or a date the provider does not cover. rateMicros is the rate times 1,000,000.",
      input_schema: {
        type: "object",
        properties: {
          date: { type: "string", description: "Rate date, YYYY-MM-DD." },
          baseCurrency: { type: "string", description: "ISO 4217 base." },
          quoteCurrency: { type: "string", description: "ISO 4217 quote." },
          rateMicros: {
            type: "number",
            description: "Rate times 1,000,000.",
            minimum: 1,
          },
          source: { type: "string", description: "Where the rate came from." },
          fetchedAt: {
            type: "string",
            description: "ISO 8601 timestamp the rate was observed.",
          },
        },
        required: [
          "date",
          "baseCurrency",
          "quoteCurrency",
          "rateMicros",
          "source",
          "fetchedAt",
        ],
      },
    },
    isWrite: true,
    category: "finance",
    execute: async (input) =>
      upsertFinanceFxSnapshot(
        parse(financeFxSnapshotSchema, input, "fx snapshot"),
      ),
  },
  {
    schema: {
      name: "import_finance_csv",
      description:
        "Import transactions from a CSV export into a standalone source account. Rows are deduplicated against what is already stored, so re-importing an overlapping export is safe.",
      input_schema: {
        type: "object",
        properties: {
          sourceId: {
            type: "string",
            description:
              "Stable id for this import source; reuse it to add to the same account.",
          },
          displayName: {
            type: "string",
            description: "Account name to show.",
          },
          currency: { type: "string", description: "ISO 4217 code." },
          csv: { type: "string", description: "The CSV text." },
        },
        required: ["sourceId", "displayName", "currency", "csv"],
      },
    },
    isWrite: true,
    category: "finance",
    execute: async (input) =>
      importFinanceCsv(parse(financeCsvImportInputSchema, input, "csv import")),
  },
  {
    schema: {
      name: "get_finance_narrative",
      description:
        "A written read of the current position — what moved, what is due, where the forecast is heading.",
      input_schema: { type: "object", properties: {} },
    },
    isWrite: false,
    category: "finance",
    execute: async () => createFinanceNarrative(),
  },
];
