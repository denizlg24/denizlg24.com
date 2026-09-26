import type {
  WorkClockAction,
  WorkHoursOverview,
  WorkJobInput,
  WorkJobUpdate,
  WorkJob as WorkJobWire,
  WorkPayPeriod,
  WorkSessionInput,
  WorkSessionUpdate,
  WorkSession as WorkSessionWire,
  WorkTotals,
} from "@repo/schemas";
import {
  monthStartDay,
  nextRecurringOccurrences,
  sessionMinutes,
  weekStartDay,
  zonedDayKey,
} from "@repo/utils";
import mongoose from "mongoose";
import { after } from "next/server";
import { estimatePayouts } from "@/lib/finance/payouts";
import { refreshPayoutProjections } from "@/lib/finance/rules";
import { connectDB } from "@/lib/mongodb";
import { FinanceRecurringRule } from "@/models/Finance";
import {
  type IWorkJob,
  type IWorkSession,
  WorkJob,
  WorkSession,
} from "@/models/WorkHours";

/**
 * The hour tracker.
 *
 * Sessions store instants; every total is derived on read, so a corrected
 * break or a backdated clock-out can never leave a stored sum disagreeing
 * with the shifts behind it. Each change that could move a payout re-projects
 * the Finance payout rules that read this job's hours.
 */

export class WorkHoursError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "WorkHoursError";
  }
}

const RECENT_LIMIT = 30;

/**
 * Re-projects after the response: a tap has to feel instant, and the
 * projection is idempotent — a lost one is redone by the next run.
 */
function schedulePayoutRefresh(jobId: string) {
  try {
    after(() => refreshPayoutProjections(jobId));
  } catch {
    // Outside a request (a script): nothing to defer to.
    void refreshPayoutProjections(jobId);
  }
}
const DEFAULT_TIMEZONE = "Europe/Copenhagen";

export function serializeWorkJob(job: IWorkJob): WorkJobWire {
  return {
    id: job._id.toString(),
    name: job.name,
    hourlyRateMinor: job.hourlyRateMinor,
    currency: job.currency,
    breaksPaid: job.breaksPaid,
    expectedWeeklyHours: job.expectedWeeklyHours ?? undefined,
    timezone: job.timezone,
    status: job.status,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

export function serializeWorkSession(
  session: IWorkSession,
  breaksPaid: boolean,
  now = new Date(),
): WorkSessionWire {
  const { workedMinutes, breakMinutes } = sessionMinutes(
    session,
    breaksPaid,
    now,
  );
  return {
    id: session._id.toString(),
    jobId: session.jobId.toString(),
    start: session.start.toISOString(),
    end: session.end?.toISOString(),
    breaks: session.breaks.map((item) => ({
      start: new Date(item.start).toISOString(),
      end: item.end ? new Date(item.end).toISOString() : undefined,
    })),
    note: session.note,
    day: session.day,
    workedMinutes,
    breakMinutes,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  };
}

async function jobOrThrow(jobId: string) {
  if (!mongoose.isValidObjectId(jobId)) {
    throw new WorkHoursError("Unknown job", 404);
  }
  const job = await WorkJob.findById(jobId);
  if (!job) throw new WorkHoursError("Unknown job", 404);
  return job;
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export async function listWorkJobs() {
  await connectDB();
  return WorkJob.find().sort({ status: 1, name: 1 });
}

export async function createWorkJob(input: WorkJobInput) {
  await connectDB();
  return WorkJob.create(input);
}

export async function updateWorkJob(id: string, input: WorkJobUpdate) {
  await connectDB();
  const { expectedWeeklyHours, ...rest } = input;
  const update: Record<string, unknown> = { $set: rest };
  if (expectedWeeklyHours === null) {
    update.$unset = { expectedWeeklyHours: 1 };
  } else if (expectedWeeklyHours !== undefined) {
    (update.$set as Record<string, unknown>).expectedWeeklyHours =
      expectedWeeklyHours;
  }
  const job = await WorkJob.findByIdAndUpdate(id, update, {
    returnDocument: "after",
    runValidators: true,
  });
  if (!job) return null;
  // A day key depends on the timezone; re-derive them if it moved.
  if (input.timezone) await rekeySessions(job);
  schedulePayoutRefresh(id);
  return job;
}

async function rekeySessions(job: IWorkJob) {
  const sessions = await WorkSession.find({ jobId: job._id }).select(
    "start day",
  );
  const operations = sessions.flatMap((session) => {
    const day = zonedDayKey(session.start, job.timezone);
    return day === session.day
      ? []
      : [{ updateOne: { filter: { _id: session._id }, update: { day } } }];
  });
  if (operations.length) await WorkSession.bulkWrite(operations);
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

function validateBreaks(
  start: Date,
  end: Date | undefined,
  breaks: { start: Date; end?: Date }[],
) {
  let openBreaks = 0;
  for (const item of breaks) {
    if (item.start < start) {
      throw new WorkHoursError("A break cannot start before the shift");
    }
    if (item.end && item.end < item.start) {
      throw new WorkHoursError("A break must end after it starts");
    }
    if (end && (!item.end || item.end > end)) {
      throw new WorkHoursError("Breaks must end within the shift");
    }
    if (!item.end) openBreaks += 1;
  }
  if (openBreaks > 1) throw new WorkHoursError("Only one break can be open");
}

export async function listWorkSessions(query: {
  from?: string;
  to?: string;
  jobId?: string;
}) {
  await connectDB();
  const filter: Record<string, unknown> = {};
  if (query.jobId && mongoose.isValidObjectId(query.jobId)) {
    filter.jobId = query.jobId;
  }
  if (query.from || query.to) {
    filter.day = {
      ...(query.from ? { $gte: query.from } : {}),
      ...(query.to ? { $lte: query.to } : {}),
    };
  }
  const [sessions, jobs] = await Promise.all([
    WorkSession.find(filter).sort({ start: -1 }).limit(1_000),
    WorkJob.find(),
  ]);
  const breaksPaid = new Map(
    jobs.map((job) => [job._id.toString(), job.breaksPaid]),
  );
  const now = new Date();
  return sessions.map((session) =>
    serializeWorkSession(
      session,
      breaksPaid.get(session.jobId.toString()) ?? false,
      now,
    ),
  );
}

export async function createWorkSession(input: WorkSessionInput) {
  await connectDB();
  const job = await jobOrThrow(input.jobId);
  const start = new Date(input.start);
  const end = input.end ? new Date(input.end) : undefined;
  if (end && end > new Date(Date.now() + 60_000)) {
    throw new WorkHoursError("A shift cannot end in the future");
  }
  const breaks = input.breaks.map((item) => ({
    start: new Date(item.start),
    end: item.end ? new Date(item.end) : undefined,
  }));
  validateBreaks(start, end, breaks);
  try {
    const session = await WorkSession.create({
      jobId: job._id,
      start,
      end,
      breaks,
      note: input.note,
      day: zonedDayKey(start, job.timezone),
      ...(end ? {} : { openKey: "open" }),
    });
    schedulePayoutRefresh(job._id.toString());
    return serializeWorkSession(session, job.breaksPaid);
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      throw new WorkHoursError("Already clocked in", 409);
    }
    throw error;
  }
}

export async function updateWorkSession(id: string, input: WorkSessionUpdate) {
  await connectDB();
  if (!mongoose.isValidObjectId(id)) return null;
  const session = await WorkSession.findById(id);
  if (!session) return null;
  const previousJobId = session.jobId.toString();
  const job = await jobOrThrow(input.jobId ?? previousJobId);

  const start = input.start ? new Date(input.start) : session.start;
  const end =
    input.end === null
      ? undefined
      : input.end
        ? new Date(input.end)
        : session.end;
  if (end && end <= start) {
    throw new WorkHoursError("A shift must end after it starts");
  }
  const breaks = input.breaks
    ? input.breaks.map((item) => ({
        start: new Date(item.start),
        end: item.end ? new Date(item.end) : undefined,
      }))
    : session.breaks.map((item) => ({ start: item.start, end: item.end }));
  validateBreaks(start, end, breaks);

  session.jobId = job._id;
  session.start = start;
  session.end = end;
  session.breaks = breaks;
  session.day = zonedDayKey(start, job.timezone);
  session.openKey = end ? undefined : "open";
  if (input.note !== undefined) session.note = input.note ?? undefined;
  try {
    await session.save();
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      throw new WorkHoursError("Another shift is already open", 409);
    }
    throw error;
  }
  schedulePayoutRefresh(job._id.toString());
  if (previousJobId !== job._id.toString()) {
    schedulePayoutRefresh(previousJobId);
  }
  return serializeWorkSession(session, job.breaksPaid);
}

export async function deleteWorkSession(id: string) {
  await connectDB();
  if (!mongoose.isValidObjectId(id)) return null;
  const session = await WorkSession.findByIdAndDelete(id);
  if (session) schedulePayoutRefresh(session.jobId.toString());
  return session;
}

// ---------------------------------------------------------------------------
// Tap actions
// ---------------------------------------------------------------------------

async function defaultJob() {
  const jobs = await WorkJob.find({ status: "active" }).sort({ name: 1 });
  if (jobs.length === 0) throw new WorkHoursError("No job set up");
  if (jobs.length === 1) return jobs[0]!;
  // With several jobs, "in" without a choice goes where the last shift was.
  const last = await WorkSession.findOne({
    jobId: { $in: jobs.map((job) => job._id) },
  }).sort({ start: -1 });
  return (
    jobs.find((job) => job._id.toString() === last?.jobId.toString()) ??
    jobs[0]!
  );
}

export async function clockWorkSession(input: WorkClockAction) {
  await connectDB();
  const at = input.at ? new Date(input.at) : new Date();
  if (at > new Date(Date.now() + 60_000)) {
    throw new WorkHoursError("Cannot clock in the future");
  }
  const open = await WorkSession.findOne({ openKey: "open" });

  if (input.action === "in") {
    if (open) throw new WorkHoursError("Already clocked in", 409);
    const job = input.jobId
      ? await jobOrThrow(input.jobId)
      : await defaultJob();
    return createWorkSession({
      jobId: job._id.toString(),
      start: at.toISOString(),
      breaks: [],
      note: input.note,
    });
  }

  if (!open) throw new WorkHoursError("Not clocked in", 409);
  if (at < open.start) {
    throw new WorkHoursError("That is before the shift started");
  }
  const job = await jobOrThrow(open.jobId.toString());
  const openBreak = open.breaks.find((item) => !item.end);

  if (input.action === "break") {
    if (openBreak) throw new WorkHoursError("Already on a break", 409);
    open.breaks.push({ start: at });
  } else if (input.action === "resume") {
    if (!openBreak) throw new WorkHoursError("Not on a break", 409);
    if (at < openBreak.start) {
      throw new WorkHoursError("That is before the break started");
    }
    openBreak.end = at;
  } else {
    // Clocking out ends a break still running; forgetting to resume is the
    // common case, and a break cannot outlast its shift.
    if (openBreak) openBreak.end = at < openBreak.start ? openBreak.start : at;
    open.end = at;
    open.openKey = undefined;
    if (input.note) open.note = input.note;
  }
  open.markModified("breaks");
  await open.save();
  if (input.action === "out") {
    schedulePayoutRefresh(job._id.toString());
  }
  return serializeWorkSession(open, job.breaksPaid);
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function totalsFor(
  sessions: WorkSessionWire[],
  predicate: (session: WorkSessionWire) => boolean,
): WorkTotals {
  const rows = sessions.filter(predicate);
  return {
    workedMinutes: rows.reduce((sum, row) => sum + row.workedMinutes, 0),
    sessionCount: rows.length,
  };
}

async function currentPayPeriods(now: Date): Promise<WorkPayPeriod[]> {
  const rules = await FinanceRecurringRule.find({
    status: "active",
    "payout.source.kind": "hours",
  });
  const periods: WorkPayPeriod[] = [];
  for (const rule of rules) {
    const payout = rule.payout;
    if (payout?.source.kind !== "hours") continue;
    const today = now.toISOString().slice(0, 10);
    // The next two payouts: the first whose period is still open is the one
    // hours are accruing into; between close and payout that is the second.
    const dates = nextRecurringOccurrences(
      {
        anchorDate: rule.anchorDate,
        recurrence: rule.recurrence as never,
        endDate: rule.endDate,
      },
      today,
      2,
    );
    if (dates.length === 0) continue;
    const estimates = await estimatePayouts(rule, dates, now);
    const current =
      [...estimates.values()].find((row) => row.phase !== "closed") ??
      estimates.get(dates[0]!);
    if (!current) continue;
    periods.push({
      ruleId: rule._id.toString(),
      ruleName: rule.name,
      jobId: payout.source.jobId,
      payoutDate: current.payoutDate,
      periodStart: current.periodStart,
      periodEnd: current.periodEnd,
      partial: current.partial,
      loggedMinutes: current.loggedMinutes,
      projectedMinutes: current.projectedMinutes,
      grossMinor: current.grossMinor,
      netMinor: current.netMinor,
      lines: current.lines,
      currency: current.currency,
    });
  }
  return periods;
}

export async function getWorkHoursOverview(
  now = new Date(),
): Promise<WorkHoursOverview> {
  await connectDB();
  const jobs = await WorkJob.find().sort({ status: 1, name: 1 });
  const timezone =
    jobs.find((job) => job.status === "active")?.timezone ?? DEFAULT_TIMEZONE;
  const today = zonedDayKey(now, timezone);
  const monthStart = monthStartDay(today);
  const weekStart = weekStartDay(today);
  const since = weekStart < monthStart ? weekStart : monthStart;

  const breaksPaid = new Map(
    jobs.map((job) => [job._id.toString(), job.breaksPaid]),
  );
  const serialize = (session: IWorkSession) =>
    serializeWorkSession(
      session,
      breaksPaid.get(session.jobId.toString()) ?? false,
      now,
    );

  const [periodSessions, recent, open, payPeriods] = await Promise.all([
    WorkSession.find({ day: { $gte: since } }),
    WorkSession.find().sort({ start: -1 }).limit(RECENT_LIMIT),
    WorkSession.findOne({ openKey: "open" }),
    currentPayPeriods(now),
  ]);
  const inRange = periodSessions.map(serialize);

  return {
    jobs: jobs.map(serializeWorkJob),
    active: open ? serialize(open) : null,
    today: totalsFor(inRange, (row) => row.day === today),
    week: totalsFor(inRange, (row) => row.day >= weekStart),
    month: totalsFor(inRange, (row) => row.day >= monthStart),
    recent: recent.map(serialize),
    payPeriods,
    serverTime: now.toISOString(),
  };
}
