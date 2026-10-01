export type AmountKey =
  | "0"
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "."
  | "/"
  | " "
  | "backspace";

const MAX_LENGTH = 9;
const DECIMAL = /^\d*[.,]?\d*$/;
const FRACTION = /^(?:(\d+) )?(\d+)\/(\d+)$/;

/**
 * What the keypad's amount reads as: a decimal (comma or point), a fraction
 * ("1/2") or a mixed number ("1 1/2"). Null while it is not a number yet.
 */
export function parseAmount(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const fraction = FRACTION.exec(trimmed);
  if (fraction) {
    const whole = Number(fraction[1] ?? 0);
    const denominator = Number(fraction[3]);
    if (denominator === 0) return null;
    return whole + Number(fraction[2]) / denominator;
  }
  if (!DECIMAL.test(trimmed)) return null;
  const value = Number(trimmed.replace(",", "."));
  return Number.isFinite(value) && trimmed !== "." ? value : null;
}

/**
 * The amount after one key. `replacing` is the state right after the field
 * opens, with the old amount selected: the first character replaces it,
 * backspace clears it. Keys that cannot make a number are ignored.
 */
export function pressAmountKey(
  text: string,
  key: AmountKey,
  replacing: boolean,
): string {
  if (key === "backspace") return replacing ? "" : text.slice(0, -1);
  const base = replacing ? "" : text;
  if (base.length >= MAX_LENGTH) return base;
  const hasSlash = base.includes("/");
  const hasSpace = base.includes(" ");
  const last = base.at(-1);
  const endsWithDigit = last !== undefined && last >= "0" && last <= "9";

  switch (key) {
    case ".":
      if (hasSlash || hasSpace || /[.,]/.test(base)) return base;
      return base === "" ? "0." : `${base}.`;
    case "/":
      if (hasSlash || !endsWithDigit || /[.,]/.test(base)) return base;
      return `${base}/`;
    case " ":
      if (hasSlash || hasSpace || !endsWithDigit || /[.,]/.test(base)) {
        return base;
      }
      return `${base} `;
    default:
      if (base === "0") return key;
      return `${base}${key}`;
  }
}
