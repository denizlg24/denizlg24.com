import { z } from "zod";
import type { StudyKey } from "./indicators";
import { symbolPattern } from "./universes";

export const overlayStudies = [
  "sma20",
  "sma50",
  "sma100",
  "sma200",
  "ema9",
  "ema21",
  "ema50",
  "bollinger",
  "rsi",
  "macd",
] as const satisfies readonly StudyKey[];
export type OverlayStudy = (typeof overlayStudies)[number];

export const overlayRanges = ["1M", "3M", "6M", "YTD", "1Y", "5Y"] as const;
export type OverlayRange = (typeof overlayRanges)[number];

export type OverlayAxis = "left" | "right" | "pane";
export type OverlayMode = "price" | "rebased" | "zscore";
export type OverlaySeries = {
  expr: string;
  axis: OverlayAxis;
  mode: OverlayMode;
  invert: boolean;
  studies: OverlayStudy[];
};

const axisCodes: Record<string, OverlayAxis> = {
  l: "left",
  r: "right",
  p: "pane",
};
const modeCodes: Record<string, OverlayMode> = {
  p: "price",
  r: "rebased",
  z: "zscore",
};
const MAX_SERIES = 8;

export const overlaySpecSchema = z.string().max(800);
export const overlayWidgetSchema = z.object({
  title: z.string().trim().min(1).max(80),
  spec: overlaySpecSchema,
  range: z.enum(overlayRanges).default("1Y"),
});

/**
 * Compact, URL-friendly encoding: series separated by `;`, fields by `,`:
 * `expr,axis(l|r|p),mode(p|r|z),flags(i),studies(+ joined)`.
 */
export function encodeOverlay(series: OverlaySeries[]) {
  return series
    .map((item) =>
      [
        item.expr.trim().replaceAll(/[;,]/g, ""),
        item.axis[0],
        item.mode === "zscore" ? "z" : item.mode[0],
        item.invert ? "i" : "",
        item.studies.join("+"),
      ]
        .join(",")
        .replace(/,+$/, ""),
    )
    .join(";");
}

export function decodeOverlay(spec: string | undefined): OverlaySeries[] {
  if (!spec) return [];
  return spec
    .split(";")
    .slice(0, MAX_SERIES)
    .flatMap((chunk): OverlaySeries[] => {
      const [expr = "", axis = "l", mode = "p", flags = "", studies = ""] =
        chunk.split(",");
      const clean = expr.trim().toUpperCase();
      if (!clean || !parseExpression(clean).ok) return [];
      return [
        {
          expr: clean,
          axis: axisCodes[axis] ?? "left",
          mode: modeCodes[mode] ?? "price",
          invert: flags.includes("i"),
          studies: studies
            .split("+")
            .filter((key): key is OverlayStudy =>
              (overlayStudies as readonly string[]).includes(key),
            ),
        },
      ];
    });
}

export type Expr =
  | { kind: "series"; id: string }
  | { kind: "number"; value: number }
  | { kind: "binary"; op: "+" | "-" | "*" | "/"; left: Expr; right: Expr }
  | { kind: "negate"; value: Expr };

const fredPattern = /^FRED:[A-Z0-9]{2,20}$/;
export const isFred = (id: string) => fredPattern.test(id);

function tokenize(input: string): string[] | null {
  const tokens: string[] = [];
  let word = "";
  const flush = () => {
    if (word) tokens.push(word);
    word = "";
  };
  for (const char of input) {
    if (/\s/.test(char)) flush();
    else if ("+*/()".includes(char)) {
      flush();
      tokens.push(char);
    } else if (char === "-" && !word) tokens.push("-");
    else word += char;
  }
  flush();
  return tokens.length > 40 ? null : tokens;
}

/**
 * Recursive-descent parser for series arithmetic. Tickers may contain `-`
 * (BRK-B), so subtraction needs spaces: `NVDA - SMH`.
 */
export function parseExpression(
  input: string,
): { ok: true; expr: Expr; ids: string[] } | { ok: false; error: string } {
  const parsed = tokenize(input.toUpperCase());
  if (!parsed?.length) return { ok: false, error: "Enter a symbol" };
  const tokens = parsed;
  let index = 0;
  const ids = new Set<string>();
  const peek = () => tokens[index];
  function primary(): Expr {
    const token = tokens[index++];
    if (token === undefined) throw new Error("Expression ends early");
    if (token === "(") {
      const inner = sum();
      if (tokens[index++] !== ")") throw new Error("Missing )");
      return inner;
    }
    if (token === "-") return { kind: "negate", value: primary() };
    if (/^\d+(\.\d+)?$/.test(token))
      return { kind: "number", value: Number(token) };
    if (isFred(token) || symbolPattern.test(token)) {
      ids.add(token);
      return { kind: "series", id: token };
    }
    throw new Error(`Unknown symbol ${token}`);
  }
  function product(): Expr {
    let left = primary();
    while (peek() === "*" || peek() === "/") {
      const op = tokens[index++] === "*" ? "*" : "/";
      left = { kind: "binary", op, left, right: primary() };
    }
    return left;
  }
  function sum(): Expr {
    let left = product();
    while (peek() === "+" || peek() === "-") {
      const op = tokens[index++] === "+" ? "+" : "-";
      left = { kind: "binary", op, left, right: product() };
    }
    return left;
  }
  try {
    const expr = sum();
    if (index !== tokens.length) throw new Error(`Unexpected ${peek()}`);
    if (ids.size === 0) throw new Error("Include at least one symbol");
    if (ids.size > 4) throw new Error("Use at most 4 symbols per series");
    return { ok: true, expr, ids: [...ids] };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid expression",
    };
  }
}

export function evaluate(
  expr: Expr,
  value: (id: string) => number | null,
): number | null {
  switch (expr.kind) {
    case "number":
      return expr.value;
    case "series":
      return value(expr.id);
    case "negate": {
      const inner = evaluate(expr.value, value);
      return inner == null ? null : -inner;
    }
    case "binary": {
      const left = evaluate(expr.left, value);
      const right = evaluate(expr.right, value);
      if (left == null || right == null) return null;
      if (expr.op === "+") return left + right;
      if (expr.op === "-") return left - right;
      if (expr.op === "*") return left * right;
      return right === 0 ? null : left / right;
    }
  }
}

export type Observation = { date: string; value: number };

/**
 * Puts every base series on one calendar. Market series define the trading
 * days; lower-frequency series (FRED) carry their last published value
 * forward, so a monthly CPI print is drawn as a step.
 */
export function alignSeries(
  market: Map<string, Observation[]>,
  stepped: Map<string, Observation[]>,
) {
  const dates = [
    ...new Set(
      [...(market.size ? market : stepped).values()].flatMap((rows) =>
        rows.map((row) => row.date),
      ),
    ),
  ].sort();
  const columns = new Map<string, (number | null)[]>();
  for (const [id, rows] of [...market, ...stepped]) {
    const byDate = new Map(rows.map((row) => [row.date, row.value]));
    const sorted = rows.toSorted((a, b) => a.date.localeCompare(b.date));
    let cursor = 0;
    let last: number | null = null;
    columns.set(
      id,
      dates.map((date) => {
        if (stepped.has(id)) {
          while (cursor < sorted.length && sorted[cursor].date <= date)
            last = sorted[cursor++].value;
          return last;
        }
        const value = byDate.get(date);
        if (value != null) last = value;
        return last;
      }),
    );
  }
  return { dates, columns };
}

/**
 * The display mapping for one series. It is affine, so the same function
 * applied to a moving average or band keeps it aligned with its series.
 */
export function scaler(
  values: (number | null)[],
  mode: OverlayMode,
  from: number,
): (value: number) => number | null {
  if (mode === "price") return (value) => value;
  const visible = values
    .slice(from)
    .filter((value): value is number => value != null);
  if (mode === "rebased") {
    const base = visible[0];
    return (value) => (base ? (value / base - 1) * 100 : null);
  }
  const mean = visible.reduce((sum, value) => sum + value, 0) / visible.length;
  const sd = Math.sqrt(
    visible.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
      Math.max(1, visible.length - 1),
  );
  return (value) => (sd ? (value - mean) / sd : null);
}

/** Correlation and beta of B's changes against A's over the same days. */
export function relation(a: (number | null)[], b: (number | null)[]) {
  const changes = (values: (number | null)[], i: number) => {
    const now = values[i];
    const prior = values[i - 1];
    if (now == null || prior == null) return null;
    return now > 0 && prior > 0 ? Math.log(now / prior) : now - prior;
  };
  const pairs: [number, number][] = [];
  for (let i = 1; i < a.length; i++) {
    const x = changes(a, i);
    const y = changes(b, i);
    if (x != null && y != null && (x !== 0 || y !== 0)) pairs.push([x, y]);
  }
  if (pairs.length < 10) return null;
  const n = pairs.length;
  const mx = pairs.reduce((sum, [x]) => sum + x, 0) / n;
  const my = pairs.reduce((sum, [, y]) => sum + y, 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of pairs) {
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
    sxy += (x - mx) * (y - my);
  }
  if (!sxx || !syy) return null;
  return {
    correlation: sxy / Math.sqrt(sxx * syy),
    beta: sxy / sxx,
    days: n,
  };
}

export const quickSeries = [
  { expr: "^VIX", label: "VIX" },
  { expr: "^TNX", label: "US 10Y yield" },
  { expr: "DX-Y.NYB", label: "Dollar index" },
  { expr: "CL=F", label: "WTI crude" },
  { expr: "GC=F", label: "Gold" },
  { expr: "BTC-USD", label: "Bitcoin" },
  { expr: "HYG", label: "High yield" },
  { expr: "FRED:T10Y2Y", label: "10Y–2Y spread" },
  { expr: "FRED:DFF", label: "Fed funds" },
  { expr: "FRED:CPIAUCSL", label: "CPI" },
] as const;
