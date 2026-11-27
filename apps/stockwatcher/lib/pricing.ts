import "server-only";
import { creditConfig, credits } from "./billing/credits";
import { creditPacks } from "./billing/polar";

export type PricedPack = {
  credits: number;
  price: string;
  per100: string;
};

const proposed = [
  { credits: 500, amount: 900, currency: "eur" },
  { credits: 2000, amount: 2900, currency: "eur" },
  { credits: 6000, amount: 6900, currency: "eur" },
];

const money = (minor: number, currency: string) =>
  new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: minor % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(minor / 100);

/** Live Polar credit packs, or the proposed packs while Polar is not configured. */
export async function pricedPacks(): Promise<PricedPack[]> {
  let packs: { credits: number; amount: number; currency: string }[] = [];
  try {
    packs = (await creditPacks()).map((pack) => ({
      credits: pack.credits,
      amount: pack.priceAmount,
      currency: pack.currency,
    }));
  } catch {
    packs = [];
  }
  if (!packs.length) packs = proposed;
  return packs.map((pack) => ({
    credits: pack.credits,
    price: money(pack.amount, pack.currency),
    per100: money(
      Math.round((pack.amount * 100) / pack.credits),
      pack.currency,
    ),
  }));
}

export const freeMonthlyCredits = () => credits(creditConfig().freeMonthly);
