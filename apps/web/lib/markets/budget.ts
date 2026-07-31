import type { BudgetPort, ProviderName } from "@repo/markets/core";
import type { ProviderBudget } from "@repo/markets/schemas";
import { connectDB } from "@/lib/mongodb";
import { MarketProviderBudget } from "@/models/Market";

export interface ProviderLimits {
  hour: number;
  day: number;
}

/**
 * EDGAR has no daily quota, only a 10 req/s ceiling the provider enforces
 * itself, so its numbers here exist to give the meter something to show.
 */
const DEFAULT_LIMITS: Record<ProviderName, ProviderLimits> = {
  tiingo: { hour: 50, day: 1000 },
  edgar: { hour: 10_000, day: 100_000 },
  finnhub: { hour: 3600, day: 86_400 },
};

function limitsFor(provider: ProviderName): ProviderLimits {
  if (provider === "tiingo") {
    return {
      hour: Number(process.env.TIINGO_HOURLY_BUDGET ?? 50),
      day: Number(process.env.TIINGO_DAILY_BUDGET ?? 1000),
    };
  }
  return DEFAULT_LIMITS[provider];
}

function hourKey(now: Date): string {
  return now.toISOString().slice(0, 13);
}

function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Counters live in one document per provider, rolled over lazily. The reserve
 * is a single conditional `$inc`: Mongo either matches the guard and increments
 * or matches nothing, so two concurrent requests can never both slip past the
 * last unit of budget.
 */
export function createMongoBudget(
  now: () => Date = () => new Date(),
): BudgetPort {
  return {
    async consume(provider, cost) {
      await connectDB();
      const stamp = now();
      const hour = hourKey(stamp);
      const day = dayKey(stamp);
      const limits = limitsFor(provider);

      await MarketProviderBudget.updateOne(
        { provider },
        {
          $setOnInsert: { hourKey: hour, dayKey: day, hourUsed: 0, dayUsed: 0 },
        },
        { upsert: true },
      );
      await MarketProviderBudget.updateOne(
        { provider, hourKey: { $ne: hour } },
        { $set: { hourKey: hour, hourUsed: 0 } },
      );
      await MarketProviderBudget.updateOne(
        { provider, dayKey: { $ne: day } },
        { $set: { dayKey: day, dayUsed: 0 } },
      );

      const reserved = await MarketProviderBudget.findOneAndUpdate(
        {
          provider,
          hourKey: hour,
          dayKey: day,
          hourUsed: { $lte: limits.hour - cost },
          dayUsed: { $lte: limits.day - cost },
        },
        { $inc: { hourUsed: cost, dayUsed: cost } },
        { new: true },
      );
      return reserved !== null;
    },

    async release(provider, cost) {
      await connectDB();
      await MarketProviderBudget.updateOne(
        { provider },
        { $inc: { hourUsed: -cost, dayUsed: -cost } },
      );
    },

    async peek(provider): Promise<ProviderBudget> {
      await connectDB();
      const stamp = now();
      const hour = hourKey(stamp);
      const day = dayKey(stamp);
      const limits = limitsFor(provider);
      const doc = await MarketProviderBudget.findOne({ provider }).lean();

      const hourResets = new Date(stamp);
      hourResets.setUTCMinutes(0, 0, 0);
      hourResets.setUTCHours(hourResets.getUTCHours() + 1);
      const dayResets = new Date(stamp);
      dayResets.setUTCHours(0, 0, 0, 0);
      dayResets.setUTCDate(dayResets.getUTCDate() + 1);

      return {
        provider,
        hourUsed: doc?.hourKey === hour ? (doc?.hourUsed ?? 0) : 0,
        hourLimit: limits.hour,
        dayUsed: doc?.dayKey === day ? (doc?.dayUsed ?? 0) : 0,
        dayLimit: limits.day,
        hourResetsAt: hourResets.toISOString(),
        dayResetsAt: dayResets.toISOString(),
      };
    },
  };
}
