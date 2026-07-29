import { createHash } from "node:crypto";
import type {
  FinanceCsvImportInput,
  FinanceManualEntryInput,
  FinanceNaturalEntryInput,
} from "@repo/schemas";
import { z } from "zod";
import { generateJson } from "@/lib/llm-service";
import { connectDB } from "@/lib/mongodb";
import {
  FinanceAccount,
  FinanceBalance,
  FinanceFxSnapshot,
} from "@/models/Finance";
import { financeBudgetDayKey } from "./core";
import { getFinanceDashboard } from "./dashboard";
import { createManualFinanceEntry, ingestBankTransactions } from "./ledger";
import { CsvBankProvider } from "./providers/csv";
import { parseDecimalMinor } from "./providers/enable-banking";

const naturalEntryResultSchema = z.object({
  amount: z.string().regex(/^\d+(?:\.\d+)?$/),
  direction: z.enum(["expense", "income"]),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  descriptor: z.string().trim().min(1).max(500),
  note: z.string().trim().max(2_000).optional(),
});

export async function createNaturalFinanceEntry(
  input: FinanceNaturalEntryInput,
) {
  await connectDB();
  const account = await FinanceAccount.findById(input.accountId);
  if (!account) throw new Error("Finance account not found");
  const today = new Date().toISOString().slice(0, 10);
  const result = await generateJson<unknown>({
    purpose: "llm-api",
    source: "finance-natural-entry",
    temperature: 0,
    system:
      "Extract one financial ledger entry. Return JSON {amount, direction, effectiveDate, descriptor, note?}. amount is an unsigned decimal string. Resolve relative dates from the supplied current date.",
    user: JSON.stringify({
      currentDate: today,
      currency: account.currency,
      text: input.text,
    }),
    logUserPrompt: JSON.stringify({
      currentDate: today,
      currency: account.currency,
      textLength: input.text.length,
    }),
  });
  const parsed = naturalEntryResultSchema.safeParse(result.json);
  if (!parsed.success) {
    throw new Error("Could not parse the finance entry");
  }
  const manualInput: FinanceManualEntryInput = {
    accountId: account._id.toString(),
    amountMinor: Math.abs(
      parseDecimalMinor(parsed.data.amount, account.currency),
    ),
    currency: account.currency,
    direction: parsed.data.direction,
    effectiveDate: parsed.data.effectiveDate,
    descriptor: parsed.data.descriptor,
    note: parsed.data.note,
  };
  return createManualFinanceEntry(manualInput);
}

export async function importFinanceCsv(input: FinanceCsvImportInput) {
  await connectDB();
  const now = new Date();
  const identificationHash = createHash("sha256")
    .update(`csv\0${input.sourceId}`)
    .digest("hex");
  const account = await FinanceAccount.findOneAndUpdate(
    { identificationHash },
    {
      $set: {
        provider: "csv",
        providerAccountRef: input.sourceId,
        institutionId: "csv",
        institutionName: "CSV",
        displayName: input.displayName,
        currency: input.currency,
        connectionStatus: "active",
      },
      $setOnInsert: {
        dailyFetchLimit: 4,
        fetchesUsed: 0,
        budgetWindowStartedAt: now,
        budgetDayKey: financeBudgetDayKey(now, "UTC"),
        budgetTimezone: "UTC",
        reservedManualFetches: 1,
        countsFailedAttempts: true,
        attendedCallsExempt: true,
      },
    },
    { upsert: true, returnDocument: "after" },
  );
  if (!account) throw new Error("Could not create CSV finance account");
  const provider = new CsvBankProvider({
    account: {
      accountRef: input.sourceId,
      identificationHash,
      institutionId: "csv",
      institutionName: "CSV",
      displayName: input.displayName,
      currency: input.currency,
    },
    csv: input.csv,
    fetchedAt: now,
  });
  const [balances, transactions] = await Promise.all([
    provider.fetchBalances(input.sourceId),
    provider.fetchTransactions(input.sourceId),
  ]);
  await Promise.all([
    FinanceBalance.bulkWrite(
      balances.map((balance) => ({
        updateOne: {
          filter: {
            accountId: account._id,
            balanceType: balance.balanceType,
          },
          update: {
            $set: {
              amountMinor: balance.amountMinor,
              currency: balance.currency,
              referenceDate: balance.referenceDate,
              fetchedAt: new Date(balance.fetchedAt),
            },
          },
          upsert: true,
        },
      })),
    ),
    ingestBankTransactions({
      accountId: account._id,
      transactions,
      observedAt: now,
      completeWindow: false,
    }),
  ]);
  account.lastSyncedAt = now;
  account.lastBookingDate = transactions
    .map((transaction) => transaction.bookingDate ?? transaction.valueDate)
    .toSorted()
    .at(-1);
  await account.save();
  return account;
}

export async function upsertFinanceFxSnapshot(input: {
  date: string;
  baseCurrency: string;
  quoteCurrency: string;
  rateMicros: number;
  source: string;
  fetchedAt: string;
}) {
  await connectDB();
  return FinanceFxSnapshot.findOneAndUpdate(
    {
      date: input.date,
      baseCurrency: input.baseCurrency,
      quoteCurrency: input.quoteCurrency,
    },
    {
      $set: {
        rateMicros: input.rateMicros,
        source: input.source,
        fetchedAt: new Date(input.fetchedAt),
      },
    },
    { upsert: true, returnDocument: "after" },
  );
}

export async function createFinanceNarrative() {
  const dashboard = await getFinanceDashboard();
  const categoryTotals = new Map<string, number>();
  for (const row of dashboard.ledger) {
    if (
      row.amountMinor >= 0 ||
      row.transferId ||
      row.origin === "projected" ||
      row.state === "void"
    ) {
      continue;
    }
    const category = row.category ?? "uncategorized";
    categoryTotals.set(
      category,
      (categoryTotals.get(category) ?? 0) + Math.abs(row.amountMinor),
    );
  }
  const result = await generateJson<{ narrative?: unknown }>({
    purpose: "llm-api",
    source: "finance-month-end-narrative",
    temperature: 0.2,
    system:
      "Write a terse month-end personal finance narrative from precomputed values. Do not recalculate or invent amounts. Return JSON {narrative}.",
    user: JSON.stringify({
      monthly: dashboard.monthly,
      forecast: dashboard.forecast,
      categories: [...categoryTotals].map(([category, amountMinor]) => ({
        category,
        amountMinor,
      })),
    }),
  });
  return {
    narrative:
      typeof result.json?.narrative === "string" ? result.json.narrative : "",
  };
}
