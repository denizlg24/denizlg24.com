import type { FinanceSettings as FinanceSettingsWire } from "@repo/schemas";
import { connectDB } from "@/lib/mongodb";
import { FinanceSettings, type IFinanceSettings } from "@/models/Finance";

const DEFAULT_BASE_CURRENCY = "EUR";

export function serializeFinanceSettings(
  settings: IFinanceSettings,
): FinanceSettingsWire {
  return {
    baseCurrency: settings.baseCurrency,
    fxSource: settings.fxSource,
    fxUpdatedAt: settings.fxUpdatedAt?.toISOString(),
  };
}

/**
 * The pinned dashboard currency. Seeded on first read from the legacy
 * `FINANCE_BASE_CURRENCY` env var so an existing deployment keeps the currency
 * it already reported rather than silently switching to the default.
 */
export async function getFinanceSettings(): Promise<IFinanceSettings> {
  await connectDB();
  const existing = await FinanceSettings.findById("singleton");
  if (existing) return existing;
  const seeded =
    process.env.FINANCE_BASE_CURRENCY?.trim().toUpperCase() ||
    DEFAULT_BASE_CURRENCY;
  return FinanceSettings.findOneAndUpdate(
    { _id: "singleton" },
    {
      $setOnInsert: {
        baseCurrency: /^[A-Z]{3}$/.test(seeded)
          ? seeded
          : DEFAULT_BASE_CURRENCY,
        fxSource: "frankfurter",
      },
    },
    { upsert: true, returnDocument: "after" },
  );
}

export async function getFinanceBaseCurrency() {
  return (await getFinanceSettings()).baseCurrency;
}

export async function updateFinanceSettings(input: {
  baseCurrency?: string;
  fxSource?: "frankfurter";
}) {
  const settings = await getFinanceSettings();
  if (input.baseCurrency) settings.baseCurrency = input.baseCurrency;
  if (input.fxSource) settings.fxSource = input.fxSource;
  await settings.save();
  return settings;
}

export async function markFinanceFxRefreshed(at: Date) {
  await FinanceSettings.updateOne(
    { _id: "singleton" },
    { $set: { fxUpdatedAt: at } },
  );
}
