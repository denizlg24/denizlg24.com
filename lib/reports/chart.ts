import { z } from "zod";
import { rangeKeys, symbolPattern } from "@/lib/universes";

export const chartKinds = [
  "line",
  "area",
  "bar",
  "stacked-bar",
  "scatter",
  "performance",
] as const;
export type ChartKind = (typeof chartKinds)[number];

export const maxSeries = 6;
export const maxPoints = 400;

const text = (max: number) => z.string().trim().min(1).max(max);
const currencyCode = z
  .string()
  .regex(/^[A-Z]{3}$|^GBp$|^ZAc$|^ILA$/, "Use an ISO currency code");
const isoTime = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/,
    "Time values must be ISO dates (YYYY-MM-DD) or datetimes",
  );

export const axisFormatSchema = z
  .object({
    format: z
      .enum(["number", "percent", "currency"])
      .default("number")
      .describe(
        "percent: values are already in percent (12.5 = 12.5%). currency: requires currency.",
      ),
    currency: currencyCode
      .optional()
      .describe("ISO code for format=currency. One currency per axis."),
    unit: z
      .string()
      .trim()
      .max(24)
      .optional()
      .describe("Unit suffix for format=number, e.g. 'x', 'bn', 'shares'"),
    decimals: z.number().int().min(0).max(4).optional(),
    label: z.string().trim().max(60).optional(),
  })
  .refine((axis) => axis.format !== "currency" || axis.currency, {
    message: "A currency axis needs a currency code",
    path: ["currency"],
  });
export type AxisFormat = z.infer<typeof axisFormatSchema>;

const xValue = z.union([z.string().trim().min(1).max(40), z.number()]);
const yValue = z.number().finite().nullable();

const seriesSchema = z.object({
  name: text(48),
  points: z
    .array(
      z.object({
        x: xValue,
        y: yValue,
        label: z
          .string()
          .trim()
          .max(24)
          .optional()
          .describe("Point label, used by scatter charts"),
      }),
    )
    .min(1)
    .max(maxPoints),
});
export type ChartSeries = z.infer<typeof seriesSchema>;

const base = {
  kind: z.enum(chartKinds),
  title: text(140),
  subtitle: z.string().trim().max(240).optional(),
  y: axisFormatSchema.default({ format: "number" }),
  note: z
    .string()
    .trim()
    .max(240)
    .optional()
    .describe("Footnote, e.g. methodology or adjustments"),
};

const inlineShape = {
  ...base,
  x: z
    .object({
      type: z
        .enum(["time", "category", "number"])
        .describe(
          "time: ISO date strings; category: labels; number: numeric (scatter)",
        ),
      label: z.string().trim().max(60).optional(),
      format: axisFormatSchema
        .optional()
        .describe("Value format for numeric x (scatter)"),
    })
    .default({ type: "category" }),
  series: z.array(seriesSchema).min(1).max(maxSeries),
  source: text(160).describe("Where the numbers come from"),
  asOf: isoTime.optional().describe("When the data was observed"),
};

function inlineIssues(
  chart: {
    kind: ChartKind;
    x: { type: "time" | "category" | "number" };
    series: ChartSeries[];
  },
  ctx: z.RefinementCtx,
) {
  if (chart.kind === "performance" && chart.x.type !== "time")
    ctx.addIssue({
      code: "custom",
      message: "A performance chart plots returns over time (x.type time)",
      path: ["x", "type"],
    });
  if (chart.kind === "scatter" && chart.x.type !== "number")
    ctx.addIssue({
      code: "custom",
      message: "A scatter chart needs numeric x values (x.type number)",
      path: ["x", "type"],
    });
  chart.series.forEach((series, s) =>
    series.points.forEach((point, p) => {
      const ok =
        chart.x.type === "number"
          ? typeof point.x === "number"
          : chart.x.type === "time"
            ? typeof point.x === "string" && isoTime.safeParse(point.x).success
            : true;
      if (!ok)
        ctx.addIssue({
          code: "custom",
          message: `x must be ${chart.x.type === "number" ? "a number" : "an ISO date"} for x.type ${chart.x.type}`,
          path: ["series", s, "points", p, "x"],
        });
    }),
  );
}

export const inlineChartSchema = z
  .object(inlineShape)
  .superRefine(inlineIssues);

export const chartSchema = z
  .object({ ...inlineShape, asOf: isoTime })
  .superRefine(inlineIssues);
export type Chart = z.infer<typeof chartSchema>;

export const marketChartSchema = z
  .object({
    ...base,
    market: z
      .object({
        symbols: z
          .array(z.string().trim().toUpperCase().regex(symbolPattern))
          .min(1)
          .max(maxSeries),
        range: z.enum(rangeKeys).optional(),
        since: z.iso
          .date()
          .optional()
          .describe("Start date (YYYY-MM-DD); overrides range"),
      })
      .describe(
        "Server fetches and freezes the data. performance: % return since start, any currencies. line/area: prices, all symbols must share one currency. bar: period % return per symbol.",
      ),
  })
  .refine((chart) => chart.kind !== "scatter", {
    message: "Scatter charts need inline data",
    path: ["kind"],
  });
export type MarketChartSpec = z.infer<typeof marketChartSchema>;

export const chartSpecSchema = z.union([marketChartSchema, inlineChartSchema]);
export type ChartSpec = z.infer<typeof chartSpecSchema>;

export const isMarketSpec = (spec: ChartSpec): spec is MarketChartSpec =>
  "market" in spec;
