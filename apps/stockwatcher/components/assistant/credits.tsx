"use client";

import useSWR from "swr";
import { api } from "@/components/shared";

export const creditsKey = "/api/billing";

type Billing =
  | { enabled: false }
  | {
      enabled: true;
      unmetered: boolean;
      balance: { available: number };
    };

const creditFormat = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

export const formatCredits = (value: number) =>
  `${creditFormat.format(value)} ${value === 1 ? "credit" : "credits"}`;

export function useCredits() {
  const { data } = useSWR(creditsKey, (url: string) => api<Billing>(url), {
    revalidateOnFocus: true,
  });
  if (!data?.enabled || data.unmetered) return null;
  return data.balance.available;
}

export function isOutOfCredits(error: Error | undefined) {
  if (!error) return false;
  try {
    const parsed: unknown = JSON.parse(error.message);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      "code" in parsed &&
      parsed.code === "out_of_credits"
    );
  } catch {
    return false;
  }
}
