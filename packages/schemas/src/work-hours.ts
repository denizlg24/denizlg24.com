import { z } from "zod";
import {
  financeCurrencySchema,
  financePayoutLineResultSchema,
} from "./finance";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoDateTimeSchema = z.iso.datetime({ offset: true });

// ---------------------------------------------------------------------------
// Work hours
//
// A job is an employer with a rate. A session is one shift: a start, an end
// (absent while clocked in) and the breaks taken during it. Worked time is
// always derived — end − start, less unpaid breaks — so editing a break can
// never leave a stale total behind. Sessions count towards the local day they
// started on, in the job's timezone, which is what a payslip means by a day.
// ---------------------------------------------------------------------------

/** An IANA zone the runtime can format in. A typo would otherwise fall back
 *  to UTC silently and key every shift and pay period by UTC days. */
const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .refine((zone) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: zone });
      return true;
    } catch {
      return false;
    }
  }, "Unknown timezone");

export const workJobSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  hourlyRateMinor: z.number().int().nonnegative(),
  currency: financeCurrencySchema,
  /** Paid breaks count as worked time. */
  breaksPaid: z.boolean(),
  /** Used to project the rest of an open pay period. */
  expectedWeeklyHours: z.number().min(0).max(168).optional(),
  timezone: z.string().min(1),
  status: z.enum(["active", "archived"]),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type WorkJob = z.infer<typeof workJobSchema>;

export const workJobInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  hourlyRateMinor: z.number().int().nonnegative(),
  currency: financeCurrencySchema,
  breaksPaid: z.boolean().default(false),
  expectedWeeklyHours: z.number().min(0).max(168).optional(),
  timezone: timezoneSchema.default("Europe/Copenhagen"),
  status: z.enum(["active", "archived"]).default("active"),
});
export type WorkJobInput = z.infer<typeof workJobInputSchema>;
export type WorkJobInputPayload = z.input<typeof workJobInputSchema>;

// Built without the input's defaults: `.partial()` keeps them, so a PATCH of
// `{ status }` would also reset `breaksPaid` and `timezone`.
export const workJobUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  hourlyRateMinor: z.number().int().nonnegative().optional(),
  currency: financeCurrencySchema.optional(),
  breaksPaid: z.boolean().optional(),
  expectedWeeklyHours: z.number().min(0).max(168).nullable().optional(),
  timezone: timezoneSchema.optional(),
  status: z.enum(["active", "archived"]).optional(),
});
export type WorkJobUpdate = z.infer<typeof workJobUpdateSchema>;
export type WorkJobUpdatePayload = z.input<typeof workJobUpdateSchema>;

export const workBreakSchema = z.object({
  start: isoDateTimeSchema,
  end: isoDateTimeSchema.optional(),
});
export type WorkBreak = z.infer<typeof workBreakSchema>;

export const workSessionSchema = z.object({
  id: z.string().min(1),
  jobId: z.string().min(1),
  start: isoDateTimeSchema,
  end: isoDateTimeSchema.optional(),
  breaks: z.array(workBreakSchema),
  note: z.string().optional(),
  /** The local day the shift counts towards. */
  day: isoDateSchema,
  /** Derived at serialization; for an open session, up to now. */
  workedMinutes: z.number().int().nonnegative(),
  breakMinutes: z.number().int().nonnegative(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type WorkSession = z.infer<typeof workSessionSchema>;

export const workSessionInputSchema = z
  .object({
    jobId: z.string().min(1),
    start: isoDateTimeSchema,
    end: isoDateTimeSchema.optional(),
    breaks: z.array(workBreakSchema).max(20).default([]),
    note: z.string().trim().max(500).optional(),
  })
  // Instants, not strings: offsets and fractional precision make ISO strings
  // sort out of time order.
  .refine(
    (value) => !value.end || Date.parse(value.end) > Date.parse(value.start),
    {
      message: "A shift must end after it starts",
      path: ["end"],
    },
  );
export type WorkSessionInput = z.infer<typeof workSessionInputSchema>;

export const workSessionUpdateSchema = z.object({
  start: isoDateTimeSchema.optional(),
  end: isoDateTimeSchema.nullable().optional(),
  breaks: z.array(workBreakSchema).max(20).optional(),
  note: z.string().trim().max(500).nullable().optional(),
  jobId: z.string().min(1).optional(),
});
export type WorkSessionUpdate = z.infer<typeof workSessionUpdateSchema>;

/**
 * The tap actions. `at` backdates one — clocking out on the bus after
 * forgetting at the door — and defaults to now.
 */
export const workClockActionSchema = z.object({
  action: z.enum(["in", "out", "break", "resume"]),
  jobId: z.string().min(1).optional(),
  at: isoDateTimeSchema.optional(),
  note: z.string().trim().max(500).optional(),
});
export type WorkClockAction = z.infer<typeof workClockActionSchema>;

export const workSessionsQuerySchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  jobId: z.string().optional(),
});

export const workTotalsSchema = z.object({
  workedMinutes: z.number().int().nonnegative(),
  sessionCount: z.number().int().nonnegative(),
});
export type WorkTotals = z.infer<typeof workTotalsSchema>;

/** The pay period the job's payout rule is currently accruing into. */
export const workPayPeriodSchema = z.object({
  ruleId: z.string().min(1),
  ruleName: z.string().min(1),
  jobId: z.string().min(1),
  payoutDate: isoDateSchema,
  periodStart: isoDateSchema,
  periodEnd: isoDateSchema,
  partial: z.boolean(),
  loggedMinutes: z.number().int().nonnegative(),
  projectedMinutes: z.number().int().nonnegative(),
  grossMinor: z.number().int().nonnegative(),
  netMinor: z.number().int().nonnegative(),
  lines: z.array(financePayoutLineResultSchema),
  currency: financeCurrencySchema,
});
export type WorkPayPeriod = z.infer<typeof workPayPeriodSchema>;

export const workHoursOverviewSchema = z.object({
  jobs: z.array(workJobSchema),
  active: workSessionSchema.nullable(),
  today: workTotalsSchema,
  week: workTotalsSchema,
  month: workTotalsSchema,
  /** Most recent first. */
  recent: z.array(workSessionSchema),
  payPeriods: z.array(workPayPeriodSchema),
  serverTime: isoDateTimeSchema,
});
export type WorkHoursOverview = z.infer<typeof workHoursOverviewSchema>;
