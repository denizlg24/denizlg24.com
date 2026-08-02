export function localNow(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 16);
}

export function toneClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return "";
  return value > 0 ? "text-emerald-600" : "text-red-600";
}

export function money(value: number): string {
  return value.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function signedMoney(value: number | null): string {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${money(value)}`;
}

/** For metrics the core already scaled to percentage points. */
export function pct(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(2)}%`;
}

/** For metrics the core returns as a fraction — CAGR, volatility, alpha. */
export function fracPct(value: number | null): string {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

export function num(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}

/** Fractional shares exist, whole ones are the norm — don't pad `10` to `10.0000`. */
export function trimQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(4);
}
