import type { BudgetPort, MeteredProvider } from "@repo/markets/core";
import type { ProviderBudget } from "@repo/markets/schemas";
import { connectDB } from "@/lib/mongodb";
import { MarketProviderBudget } from "@/models/Market";

export interface ProviderLimits {
  hour: number;
  day: number;
}

/**
 * EDGAR has no daily quota, only a 10 req/s ceiling the provider enforces
 * itself, so its numbers here exist to keep a runaway loop bounded.
 */
const LIMITS: Record<MeteredProvider, ProviderLimits> = {
  edgar: { hour: 10_000, day: 100_000 },
  finnhub: { hour: 3600, day: 86_400 },
};

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
      const limits = LIMITS[provider];

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
        { returnDocument: "after" },
      );
      return reserved !== null;
    },

    /**
     * Scoped to the window the reservation was made in. A rollover between
     * `consume` and `release` would otherwise decrement the fresh window's
     * counters, drive them negative, and hand out more capacity than the
     * provider quota allows.
     */
    async release(provider, cost) {
      await connectDB();
      const stamp = now();
      const hour = hourKey(stamp);
      const day = dayKey(stamp);

      await MarketProviderBudget.updateOne(
        { provider, hourKey: hour, hourUsed: { $gte: cost } },
        { $inc: { hourUsed: -cost } },
      );
      await MarketProviderBudget.updateOne(
        { provider, dayKey: day, dayUsed: { $gte: cost } },
        { $inc: { dayUsed: -cost } },
      );
    },

    async peek(provider): Promise<ProviderBudget> {
      await connectDB();
      const stamp = now();
      const hour = hourKey(stamp);
      const day = dayKey(stamp);
      const limits = LIMITS[provider];
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
