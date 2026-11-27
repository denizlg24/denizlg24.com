"use client";

import useSWR from "swr";
import { api } from "@/components/shared";

export const creditsKey = "/api/billing";

type Billing =
  | { enabled: false }
  | {
      enabled: true;
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
  if (!data?.enabled) return null;
  return data.balance.available;
}

const outOfCreditsBody = (error: Error | undefined) => {
  if (!error) return null;
  try {
    const parsed: unknown = JSON.parse(error.message);
    return typeof parsed === "object" &&
      parsed !== null &&
      "code" in parsed &&
      parsed.code === "out_of_credits"
      ? parsed
      : null;
  } catch {
    return null;
  }
};

export const isOutOfCredits = (error: Error | undefined) =>
  outOfCreditsBody(error) !== null;

/** The server's explanation, which says how much a reply needs when credits are low rather than gone. */
export function outOfCreditsMessage(error: Error | undefined) {
  const body = outOfCreditsBody(error);
  return body && "error" in body && typeof body.error === "string"
    ? body.error
    : "You are out of credits.";
}
