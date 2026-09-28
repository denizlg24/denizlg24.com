import { differenceInCalendarDays, format, parseISO } from "date-fns";

const KJ_PER_KCAL = 4.184;
const LB_PER_KG = 2.2046226218;

const integer = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
});

export function formatInteger(value: number): string {
  return integer.format(Math.round(value));
}

/** Up to one decimal, dropping a trailing `.0`. */
export function formatDecimal(value: number): string {
  return oneDecimal.format(value);
}

export type EnergyUnit = "kcal" | "kj";
export type WeightUnit = "kg" | "lb";

export function energyValue(kcal: number, unit: EnergyUnit): number {
  return unit === "kj" ? kcal * KJ_PER_KCAL : kcal;
}

export function formatEnergy(kcal: number, unit: EnergyUnit = "kcal"): string {
  return formatInteger(energyValue(kcal, unit));
}

export function energyLabel(unit: EnergyUnit): string {
  return unit === "kj" ? "kJ" : "kcal";
}

export function formatGrams(grams: number): string {
  return `${grams >= 10 ? formatInteger(grams) : formatDecimal(grams)} g`;
}

export function weightValue(kg: number, unit: WeightUnit): number {
  return unit === "lb" ? kg * LB_PER_KG : kg;
}

export function kgFromUnit(value: number, unit: WeightUnit): number {
  return unit === "lb" ? value / LB_PER_KG : value;
}

export function formatWeight(kg: number, unit: WeightUnit = "kg"): string {
  return `${formatDecimal(weightValue(kg, unit))} ${unit}`;
}

/** Signed change, e.g. "−0.4 kg" or "+1.2 kg". */
export function formatWeightDelta(kg: number, unit: WeightUnit = "kg"): string {
  const value = weightValue(kg, unit);
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${formatDecimal(Math.abs(value))} ${unit}`;
}

/** "Today", "Yesterday", "Tomorrow", a weekday this week, else "Mon 3 Sep". */
export function formatDayLabel(isoDate: string, todayIso: string): string {
  const date = parseISO(isoDate);
  const diff = differenceInCalendarDays(date, parseISO(todayIso));
  if (diff === 0) return "Today";
  if (diff === -1) return "Yesterday";
  if (diff === 1) return "Tomorrow";
  if (diff > -7 && diff < 0) return format(date, "EEEE");
  return format(date, "EEE d MMM");
}

export function formatShortDate(isoDate: string): string {
  return format(parseISO(isoDate), "d MMM");
}
