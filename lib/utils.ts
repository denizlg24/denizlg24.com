import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const numberFormat = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});
const moneyFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const shortFormat = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
});

export const amount = (value: number | null | undefined) =>
  value == null ? "—" : moneyFormat.format(value);
export const number = (value: number | null | undefined) =>
  value == null ? "—" : numberFormat.format(value);
export const compact = (value: number | null | undefined) =>
  value == null ? "—" : shortFormat.format(value);
export const percent = (value: number | null | undefined) =>
  value == null ? "—" : `${value > 0 ? "+" : ""}${amount(value)}%`;
export const tone = (value: number | null | undefined) =>
  value == null || value === 0
    ? "neutral"
    : value > 0
      ? "positive"
      : "negative";
const marketTimeFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});
const localDateFormat = new Intl.DateTimeFormat("sv-SE");

export const marketTime = (time: number) =>
  marketTimeFormat.format(time * 1000);
export const today = () => localDateFormat.format(new Date());
