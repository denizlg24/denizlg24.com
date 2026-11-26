import { z } from "zod";
import type { News } from "./models";
import { symbolPattern, universeKeys } from "./universes";
import { overlayRanges, overlaySpecSchema } from "./overlay";

const ticker = z.string().regex(symbolPattern);
const group = z.enum(universeKeys);
export const dashboardSchema = z.object({
  view: z.enum([
    "markets",
    "portfolio",
    "research",
    "watchlists",
    "alerts",
    "security",
    "monitor",
    "overlay",
  ]),
  spec: overlaySpecSchema.optional(),
  period: z.enum(overlayRanges).optional(),
  fn: z
    .string()
    .regex(/^[A-Z]{1,5}$/)
    .optional(),
  researchTab: z.enum(["company", "filings", "social", "journal"]).optional(),
  ticker: ticker.optional(),
  symbols: z.array(ticker).max(120).optional(),
  universe: group.optional(),
  excluded: z.array(ticker).max(120).optional(),
  since: z.iso.date().optional(),
  cik: z
    .string()
    .regex(/^\d{1,10}$/)
    .optional(),
});

export type DashboardState = z.infer<typeof dashboardSchema>;
export type AssistantResult = Partial<DashboardState> & {
  answer: string;
  alert?: { symbol: string; direction: "above" | "below"; target: number };
  sources?: Pick<News, "title" | "url">[];
};

export function dashboardLink(state: DashboardState) {
  const query = new URLSearchParams();
  for (const key of [
    "researchTab",
    "ticker",
    "universe",
    "since",
    "cik",
    "fn",
    "spec",
    "period",
  ] as const) {
    if (state[key]) query.set(key, state[key]);
  }
  for (const key of ["symbols", "excluded"] as const) {
    if (state[key]) query.set(key, state[key].join(","));
  }
  return `#${state.view}${query.size ? `?${query}` : ""}`;
}

export function dashboardFromHash(hash: string): DashboardState | undefined {
  const separator = hash.indexOf("?");
  if (separator < 0) return undefined;
  const params = new URLSearchParams(hash.slice(separator + 1));
  const data = Object.fromEntries(params) as Record<string, unknown>;
  for (const key of ["symbols", "excluded"]) {
    if (params.has(key))
      data[key] = (params.get(key) ?? "").split(",").filter(Boolean);
  }
  const result = dashboardSchema.safeParse({
    ...data,
    view: hash.slice(0, separator),
  });
  return result.success ? result.data : undefined;
}

export function dashboardFromResult(
  result: AssistantResult,
): DashboardState | undefined {
  const state = dashboardSchema.safeParse(result);
  return state.success ? state.data : undefined;
}

export function supportedStartDate(date: string, now = new Date()) {
  const minimum = new Date(now);
  minimum.setUTCFullYear(now.getUTCFullYear() - 20);
  return (
    z.iso.date().safeParse(date).success &&
    date >= minimum.toISOString().slice(0, 10) &&
    date <= now.toISOString().slice(0, 10)
  );
}

export function dashboardReturn(fragment: unknown) {
  if (
    typeof fragment !== "string" ||
    fragment.length > 2400 ||
    !fragment.startsWith("#")
  )
    return "";
  const hash = fragment.slice(1);
  const state = dashboardFromHash(hash);
  if (state) return dashboardLink(state);
  return dashboardSchema.shape.view.safeParse(hash).success ? fragment : "";
}

export const askUserInputSchema = z.object({
  question: z.string().trim().min(1).max(300),
  context: z
    .string()
    .max(400)
    .optional()
    .describe("One short sentence on why the answer matters."),
  options: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(80),
        description: z.string().max(200).optional(),
      }),
    )
    .min(2)
    .max(6),
  multiple: z
    .boolean()
    .default(false)
    .describe("Allow selecting several options."),
  allowOther: z
    .boolean()
    .default(true)
    .describe("Offer a free-text answer besides the options."),
});
export const askUserOutputSchema = z.object({
  selected: z.array(z.string().max(80)).max(6),
  other: z.string().max(500).optional(),
  skipped: z.boolean().optional(),
});
export type AskUserInput = z.infer<typeof askUserInputSchema>;
export type AskUserOutput = z.infer<typeof askUserOutputSchema>;
