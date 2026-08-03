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

/**
 * A non-numeric override would make every `$lte: NaN - cost` guard match
 * nothing, so every request would be refused for good and the dashboard would
 * serve only stale data. Fall back to the default instead.
 */
function envLimit(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    console.warn(
      `[markets] ${name}="${raw}" is not a budget; using ${fallback}`,
    );
    return fallback;
  }
  return parsed;
}

/**
 * Tiingo meters per key, so the configured budget is what *one* key allows and
 * the ceiling is that times however many are in rotation. The provider sends
 * requests round-robin, which is what makes the sum the real limit rather than
 * an optimistic one.
 */
function limitsFor(provider: ProviderName, keyCount: number): ProviderLimits {
  if (provider === "tiingo") {
    return {
      hour: envLimit("TIINGO_HOURLY_BUDGET", 50) * keyCount,
      day: envLimit("TIINGO_DAILY_BUDGET", 1000) * keyCount,
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
  tiingoKeyCount = 1,
): BudgetPort {
  return {
    async consume(provider, cost) {
      await connectDB();
      const stamp = now();
      const hour = hourKey(stamp);
      const day = dayKey(stamp);
      const limits = limitsFor(provider, tiingoKeyCount);

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
      const limits = limitsFor(provider, tiingoKeyCount);
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
