import { z } from "zod";
import type { News } from "./models";
import { symbolPattern, universeKeys } from "./universes";

const ticker = z.string().regex(symbolPattern);
const group = z.enum(universeKeys);
export const dashboardSchema = z.object({
  view: z.enum(["markets", "portfolio", "research", "watchlists", "alerts"]),
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
