import { z } from "zod";

export const screenLookbacks = {
  "1W": 7,
  "1M": 30,
  "3M": 91,
  "6M": 182,
  YTD: 0,
  "1Y": 365,
} as const;
export type Lookback = keyof typeof screenLookbacks;
export const lookbackKeys = Object.keys(screenLookbacks) as [
  Lookback,
  ...Lookback[],
];
const rangeSchema = z.tuple([z.string().max(20), z.string().max(20)]);
export type Range = z.infer<typeof rangeSchema>;
export const screenSchema = z.object({
  name: z.string().max(80),
  sectors: z.array(z.string().max(60)).max(20),
  query: z.string().max(80),
  price: rangeSchema,
  day: rangeSchema,
  period: rangeSchema,
  position: rangeSchema,
  turnover: z.string().max(20),
  lookback: z.enum(lookbackKeys),
});
export type Screen = z.infer<typeof screenSchema>;
