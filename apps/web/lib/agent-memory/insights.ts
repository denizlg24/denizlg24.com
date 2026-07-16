import { randomUUID } from "node:crypto";
import type { AgentInsightCategory } from "@repo/schemas";
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { AgentAuditEvent } from "@/models/AgentAuditEvent";
import { AgentEvidenceEvent } from "@/models/AgentEvidenceEvent";
import { AgentFeedbackEvent } from "@/models/AgentFeedbackEvent";
import { AgentGoal } from "@/models/AgentGoal";
import { AgentInsight, type IAgentInsight } from "@/models/AgentInsight";
import { AgentMemoryJob, type IAgentMemoryJob } from "@/models/AgentMemoryJob";
import { AgentMemoryRun } from "@/models/AgentMemoryRun";
import { CalendarEvent } from "@/models/CalendarEvent";
import { AgentMemoryPolicyError } from "./policy";
import { getAgentMemorySettings } from "./settings";

const INSIGHT_PROMPT_VERSION = "agent-memory-insight-deterministic-v1";
const INSIGHT_SCHEMA_VERSION = "agent-insight-v1";

const GOAL_LOOKAHEAD_DAYS = 7;
const CALENDAR_LOOKAHEAD_DAYS = 7;
const FOLLOW_UP_STALE_DAYS = 3;
const FAILURE_WINDOW_DAYS = 7;
const REPEATED_FAILURE_THRESHOLD = 3;
const MIN_INSIGHT_CONFIDENCE = 0.4;
const DEFAULT_EVENT_DURATION_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;
const MAX_TRIGGER_EVIDENCE = 20;

export interface InsightGoalInput {
  id: string;
  title: string;
  kind: string;
  status: string;
  targetUntil?: Date;
  updatedAt: Date;
  progressEvidenceIds: string[];
}

export interface InsightCalendarEventInput {
  id: string;
  title: string;
  date: Date;
  endDate?: Date;
  isAllDay: boolean;
  status: string;
  suppressed?: boolean;
}

export interface InsightFailureInput {
  createdAt: Date;
  toolName: string;
  evidenceIds: string[];
}

export interface AgentInsightDraft {
  idempotencyKey: string;
  category: AgentInsightCategory;
  title: string;
  body: string;
  triggerEvidenceIds: string[];
  reason: string;
  proposedAction?: Record<string, unknown>;
  expectedUsefulness: number;
  urgency: number;
  confidence: number;
  interruptionCost: number;
  expiresAt: Date;
}

export interface InsightPolicyOptions {
  enabledCategories: string[];
  maxInsightsPerDay: number;
  createdTodayByCategory: Record<string, number>;
  existingKeys: Set<string>;
  categoryFeedback: Record<string, { accepted: number; dismissed: number }>;
}

export type InsightRejectionReason =
  | "category-disabled"
  | "low-confidence"
  | "duplicate"
  | "rate-limited";

export interface InsightPolicyResult {
  accepted: (AgentInsightDraft & { delivery: "in-app" | "silent-draft" })[];
  rejected: {
    idempotencyKey: string;
    category: string;
    reason: InsightRejectionReason;
  }[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfUtcDay(date: Date): Date {
  return new Date(`${utcDayKey(date)}T00:00:00.000Z`);
}

function endOfUtcDay(date: Date): Date {
  return new Date(startOfUtcDay(date).getTime() + DAY_MS);
}

export function isoWeekKey(date: Date): string {
  const day = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((day.getTime() - yearStart) / DAY_MS + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function eventEnd(event: InsightCalendarEventInput): Date {
  return (
    event.endDate ?? new Date(event.date.getTime() + DEFAULT_EVENT_DURATION_MS)
  );
}

function timeLabel(date: Date): string {
  return date.toISOString().slice(0, 16).replace("T", " ");
}

export function goalDeadlineInsights(
  now: Date,
  goals: InsightGoalInput[],
): AgentInsightDraft[] {
  const horizon = now.getTime() + GOAL_LOOKAHEAD_DAYS * DAY_MS;
  return goals
    .filter(
      (goal) =>
        goal.status === "active" &&
        goal.targetUntil &&
        goal.targetUntil.getTime() > now.getTime() &&
        goal.targetUntil.getTime() <= horizon,
    )
    .map((goal) => {
      const targetUntil = goal.targetUntil as Date;
      const daysLeft = (targetUntil.getTime() - now.getTime()) / DAY_MS;
      return {
        idempotencyKey: `insight:goal-deadline:${goal.id}:${utcDayKey(targetUntil)}`,
        category: "goal-deadline" as const,
        title: `Goal deadline approaching: ${goal.title}`.slice(0, 512),
        body: `"${goal.title}" is due ${timeLabel(targetUntil)} UTC (${Math.ceil(daysLeft)} day(s) left).`.slice(
          0,
          4_096,
        ),
        triggerEvidenceIds: goal.progressEvidenceIds.slice(
          0,
          MAX_TRIGGER_EVIDENCE,
        ),
        reason: `Active goal target date falls within the ${GOAL_LOOKAHEAD_DAYS}-day lookahead window.`,
        proposedAction: {
          kind: "review",
          targetType: "goal",
          targetIds: [goal.id],
        },
        expectedUsefulness: 0.75,
        urgency: clamp(1 - daysLeft / GOAL_LOOKAHEAD_DAYS, 0.25, 1),
        confidence: 0.9,
        interruptionCost: 0.2,
        expiresAt: targetUntil,
      };
    });
}

export function calendarConflictInsights(
  now: Date,
  events: InsightCalendarEventInput[],
): AgentInsightDraft[] {
  const horizon = now.getTime() + CALENDAR_LOOKAHEAD_DAYS * DAY_MS;
  const candidates = events
    .filter(
      (event) =>
        event.status === "scheduled" &&
        !event.isAllDay &&
        !event.suppressed &&
        eventEnd(event).getTime() > now.getTime() &&
        event.date.getTime() <= horizon,
    )
    .sort((left, right) => left.date.getTime() - right.date.getTime());

  const drafts: AgentInsightDraft[] = [];
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const first = candidates[i];
      const second = candidates[j];
      if (!first || !second) continue;
      if (second.date.getTime() >= eventEnd(first).getTime()) break;
      const [a, b] = [first, second].sort((left, right) =>
        left.id.localeCompare(right.id),
      ) as [InsightCalendarEventInput, InsightCalendarEventInput];
      const firstStart = new Date(
        Math.min(first.date.getTime(), second.date.getTime()),
      );
      const hoursToStart =
        (firstStart.getTime() - now.getTime()) / (60 * 60 * 1_000);
      drafts.push({
        idempotencyKey: `insight:calendar-conflict:${a.id}:${b.id}`,
        category: "calendar-conflict",
        title: `Calendar conflict: ${first.title} / ${second.title}`.slice(
          0,
          512,
        ),
        body: `"${first.title}" (${timeLabel(first.date)} - ${timeLabel(eventEnd(first))} UTC) overlaps "${second.title}" (${timeLabel(second.date)} - ${timeLabel(eventEnd(second))} UTC).`.slice(
          0,
          4_096,
        ),
        triggerEvidenceIds: [],
        reason: `Two scheduled calendar events overlap within the ${CALENDAR_LOOKAHEAD_DAYS}-day lookahead window.`,
        proposedAction: {
          kind: "review",
          targetType: "calendar",
          targetIds: [a.id, b.id],
        },
        expectedUsefulness: 0.8,
        urgency: clamp(
          1 - hoursToStart / (CALENDAR_LOOKAHEAD_DAYS * 24),
          0.3,
          1,
        ),
        confidence: 0.95,
        interruptionCost: 0.3,
        expiresAt: new Date(
          Math.max(firstStart.getTime(), now.getTime() + 60 * 60 * 1_000),
        ),
      });
    }
  }
  return drafts;
}

export function staleFollowUpInsights(
  now: Date,
  goals: InsightGoalInput[],
): AgentInsightDraft[] {
  const staleBefore = now.getTime() - FOLLOW_UP_STALE_DAYS * DAY_MS;
  return goals
    .filter(
      (goal) =>
        goal.kind === "agent-follow-up" &&
        goal.status === "active" &&
        goal.updatedAt.getTime() <= staleBefore,
    )
    .map((goal) => ({
      idempotencyKey: `insight:follow-up:${goal.id}:${goal.updatedAt.toISOString()}`,
      category: "follow-up" as const,
      title: `Unresolved follow-up: ${goal.title}`.slice(0, 512),
      body: `The agent follow-up "${goal.title}" has had no progress since ${timeLabel(goal.updatedAt)} UTC.`.slice(
        0,
        4_096,
      ),
      triggerEvidenceIds: goal.progressEvidenceIds.slice(
        0,
        MAX_TRIGGER_EVIDENCE,
      ),
      reason: `Agent follow-up untouched for more than ${FOLLOW_UP_STALE_DAYS} days.`,
      proposedAction: {
        kind: "review",
        targetType: "goal",
        targetIds: [goal.id],
      },
      expectedUsefulness: 0.6,
      urgency: 0.4,
      confidence: 0.7,
      interruptionCost: 0.2,
      expiresAt: new Date(now.getTime() + 7 * DAY_MS),
    }));
}

export function repeatedFailureInsights(
  now: Date,
  failures: InsightFailureInput[],
): AgentInsightDraft[] {
  const windowStart = now.getTime() - FAILURE_WINDOW_DAYS * DAY_MS;
  const byTool = new Map<string, InsightFailureInput[]>();
  for (const failure of failures) {
    if (failure.createdAt.getTime() < windowStart) continue;
    const list = byTool.get(failure.toolName) ?? [];
    list.push(failure);
    byTool.set(failure.toolName, list);
  }
  const drafts: AgentInsightDraft[] = [];
  for (const [toolName, toolFailures] of [...byTool.entries()].sort(
    ([a], [b]) => a.localeCompare(b),
  )) {
    if (toolFailures.length < REPEATED_FAILURE_THRESHOLD) continue;
    drafts.push({
      idempotencyKey: `insight:repeated-failure:${toolName}:${isoWeekKey(now)}`,
      category: "repeated-failure",
      title: `Repeated tool failures: ${toolName}`.slice(0, 512),
      body: `The tool "${toolName}" failed ${toolFailures.length} times in the last ${FAILURE_WINDOW_DAYS} days. A procedure or configuration change may be needed.`.slice(
        0,
        4_096,
      ),
      triggerEvidenceIds: [
        ...new Set(toolFailures.flatMap((failure) => failure.evidenceIds)),
      ].slice(0, MAX_TRIGGER_EVIDENCE),
      reason: `At least ${REPEATED_FAILURE_THRESHOLD} failures of the same tool inside the ${FAILURE_WINDOW_DAYS}-day window.`,
      proposedAction: {
        kind: "review",
        targetType: "procedure",
        targetIds: [toolName],
      },
      expectedUsefulness: 0.6,
      urgency: 0.35,
      confidence: clamp(0.4 + toolFailures.length * 0.1, 0, 1),
      interruptionCost: 0.25,
      expiresAt: new Date(now.getTime() + 7 * DAY_MS),
    });
  }
  return drafts;
}

export function buildDailyBriefing(
  now: Date,
  input: {
    goalsDueSoon: InsightGoalInput[];
    todaysEvents: InsightCalendarEventInput[];
    pendingInsights: number;
  },
): AgentInsightDraft {
  const lines: string[] = [];
  if (input.todaysEvents.length > 0) {
    lines.push(`Today's calendar (${input.todaysEvents.length}):`);
    for (const event of input.todaysEvents.slice(0, 5)) {
      lines.push(
        `- ${event.isAllDay ? "all day" : timeLabel(event.date).slice(11)} ${event.title}`,
      );
    }
  } else {
    lines.push("No calendar events today.");
  }
  if (input.goalsDueSoon.length > 0) {
    lines.push(
      `Goals due within ${GOAL_LOOKAHEAD_DAYS} days (${input.goalsDueSoon.length}):`,
    );
    for (const goal of input.goalsDueSoon.slice(0, 3)) {
      lines.push(
        `- ${goal.title}${goal.targetUntil ? ` (due ${utcDayKey(goal.targetUntil)})` : ""}`,
      );
    }
  } else {
    lines.push("No goal deadlines in the next week.");
  }
  lines.push(
    input.pendingInsights > 0
      ? `${input.pendingInsights} insight(s) waiting in the inbox.`
      : "The insight inbox is clear.",
  );
  return {
    idempotencyKey: `insight:daily-briefing:${utcDayKey(now)}`,
    category: "daily-briefing",
    title: `Daily briefing — ${utcDayKey(now)}`,
    body: lines.join("\n").slice(0, 4_096),
    triggerEvidenceIds: [],
    reason: "Scheduled daily summary of calendar, goals, and open insights.",
    expectedUsefulness: 0.7,
    urgency: 0.5,
    confidence: 1,
    interruptionCost: 0.1,
    expiresAt: endOfUtcDay(now),
  };
}

export function categoryPreference(
  category: string,
  feedback: Record<string, { accepted: number; dismissed: number }>,
): number {
  const stats = feedback[category] ?? { accepted: 0, dismissed: 0 };
  return (stats.accepted + 1) / (stats.accepted + stats.dismissed + 2);
}

export function applyInsightPolicy(
  drafts: AgentInsightDraft[],
  options: InsightPolicyOptions,
): InsightPolicyResult {
  const result: InsightPolicyResult = { accepted: [], rejected: [] };
  const counts = { ...options.createdTodayByCategory };
  for (const draft of drafts) {
    // Empty enabledCategories means every category is on (default-on proactivity);
    // a non-empty list narrows delivery to the listed categories.
    if (
      options.enabledCategories.length > 0 &&
      !options.enabledCategories.includes(draft.category)
    ) {
      result.rejected.push({
        idempotencyKey: draft.idempotencyKey,
        category: draft.category,
        reason: "category-disabled",
      });
      continue;
    }
    if (draft.confidence < MIN_INSIGHT_CONFIDENCE) {
      result.rejected.push({
        idempotencyKey: draft.idempotencyKey,
        category: draft.category,
        reason: "low-confidence",
      });
      continue;
    }
    if (options.existingKeys.has(draft.idempotencyKey)) {
      result.rejected.push({
        idempotencyKey: draft.idempotencyKey,
        category: draft.category,
        reason: "duplicate",
      });
      continue;
    }
    if ((counts[draft.category] ?? 0) >= options.maxInsightsPerDay) {
      result.rejected.push({
        idempotencyKey: draft.idempotencyKey,
        category: draft.category,
        reason: "rate-limited",
      });
      continue;
    }
    counts[draft.category] = (counts[draft.category] ?? 0) + 1;
    const preference = categoryPreference(
      draft.category,
      options.categoryFeedback,
    );
    const interruptScore =
      draft.expectedUsefulness * draft.urgency * preference;
    result.accepted.push({
      ...draft,
      delivery:
        draft.category === "daily-briefing" ||
        interruptScore >= draft.interruptionCost
          ? "in-app"
          : "silent-draft",
    });
  }
  return result;
}

async function loadCalendarEvidenceIds(
  eventIds: string[],
): Promise<Map<string, string>> {
  if (eventIds.length === 0) return new Map();
  const evidence = await AgentEvidenceEvent.find({
    "sourceRef.entityType": "calendar",
    "sourceRef.entityId": { $in: eventIds },
  })
    .sort({ observedAt: -1 })
    .limit(100)
    .select("eventId sourceRef")
    .lean();
  const byEntity = new Map<string, string>();
  for (const event of evidence) {
    const entityId = event.sourceRef?.entityId;
    if (entityId && !byEntity.has(entityId))
      byEntity.set(entityId, event.eventId);
  }
  return byEntity;
}

export async function runInsightSweep(
  now = new Date(),
  // force lets the owner-triggered manual sweep run before Gate F is released,
  // mirroring runManualReflection; scheduled jobs never pass it.
  options: { force?: boolean } = {},
) {
  const settings = await getAgentMemorySettings();
  if (!settings.releaseGates.proactivity && !options.force) {
    return { ran: false, reason: "proactivity-disabled" } as const;
  }
  await connectDB();

  const woken = await AgentInsight.updateMany(
    { status: "snoozed", snoozedUntil: { $lte: now }, expiresAt: { $gt: now } },
    { $set: { status: "pending" }, $unset: { snoozedUntil: 1 } },
  );
  const expired = await AgentInsight.updateMany(
    {
      status: { $in: ["pending", "delivered", "snoozed"] },
      expiresAt: { $lte: now },
    },
    { $set: { status: "expired" } },
  );

  const run = await AgentMemoryRun.create({
    operation: "insight",
    status: "running",
    promptVersion: INSIGHT_PROMPT_VERSION,
    schemaVersion: INSIGHT_SCHEMA_VERSION,
    inputIds: [],
    outputIds: [],
    startedAt: now,
  });

  try {
    const [goals, events, failures, feedbackEvents, todays, pendingInsights] =
      await Promise.all([
        AgentGoal.find({ status: "active" })
          .sort({ targetUntil: 1, updatedAt: -1 })
          .limit(200)
          .lean(),
        CalendarEvent.find({
          status: "scheduled",
          date: {
            $gte: startOfUtcDay(now),
            $lte: new Date(now.getTime() + CALENDAR_LOOKAHEAD_DAYS * DAY_MS),
          },
        })
          .limit(500)
          .lean(),
        AgentFeedbackEvent.find({
          kind: "tool-failed",
          createdAt: {
            $gte: new Date(now.getTime() - FAILURE_WINDOW_DAYS * DAY_MS),
          },
        })
          .limit(500)
          .lean(),
        AgentFeedbackEvent.find({
          kind: { $in: ["suggestion-accepted", "suggestion-dismissed"] },
          createdAt: { $gte: new Date(now.getTime() - 30 * DAY_MS) },
        })
          .limit(1_000)
          .select("kind boundedDiff")
          .lean(),
        AgentInsight.find({ createdAt: { $gte: startOfUtcDay(now) } })
          .select("category")
          .lean(),
        AgentInsight.countDocuments({
          status: "pending",
          expiresAt: { $gt: now },
          category: { $nin: EXCLUDED_INSIGHT_CATEGORIES },
        }),
      ]);

    const goalInputs: InsightGoalInput[] = goals.map((goal) => ({
      id: goal._id.toString(),
      title: goal.title,
      kind: goal.kind,
      status: goal.status,
      targetUntil: goal.targetUntil ? new Date(goal.targetUntil) : undefined,
      updatedAt: new Date(goal.updatedAt),
      progressEvidenceIds: goal.progressEvidenceIds ?? [],
    }));
    const eventInputs: InsightCalendarEventInput[] = events.map((event) => ({
      id: String(event._id),
      title: event.title,
      date: new Date(event.date),
      endDate: event.endDate ? new Date(event.endDate) : undefined,
      isAllDay: event.isAllDay,
      status: event.status,
      suppressed: event.source?.isSuppressed ?? false,
    }));
    const failureInputs: InsightFailureInput[] = failures.map((failure) => ({
      createdAt: new Date(failure.createdAt),
      toolName:
        typeof failure.boundedDiff?.toolName === "string"
          ? failure.boundedDiff.toolName
          : "unknown-tool",
      evidenceIds: failure.evidenceIds ?? [],
    }));

    const categoryFeedback: Record<
      string,
      { accepted: number; dismissed: number }
    > = {};
    for (const event of feedbackEvents) {
      const category =
        typeof event.boundedDiff?.category === "string"
          ? event.boundedDiff.category
          : null;
      if (!category) continue;
      const stats = categoryFeedback[category] ?? {
        accepted: 0,
        dismissed: 0,
      };
      if (event.kind === "suggestion-accepted") stats.accepted += 1;
      else stats.dismissed += 1;
      categoryFeedback[category] = stats;
    }

    const createdTodayByCategory: Record<string, number> = {};
    for (const insight of todays) {
      createdTodayByCategory[insight.category] =
        (createdTodayByCategory[insight.category] ?? 0) + 1;
    }

    const horizon = now.getTime() + GOAL_LOOKAHEAD_DAYS * DAY_MS;
    const drafts: AgentInsightDraft[] = [
      ...goalDeadlineInsights(now, goalInputs),
      ...staleFollowUpInsights(now, goalInputs),
      ...calendarConflictInsights(now, eventInputs),
      ...repeatedFailureInsights(now, failureInputs),
      buildDailyBriefing(now, {
        goalsDueSoon: goalInputs.filter(
          (goal) =>
            goal.targetUntil &&
            goal.targetUntil.getTime() > now.getTime() &&
            goal.targetUntil.getTime() <= horizon,
        ),
        todaysEvents: eventInputs.filter(
          (event) =>
            event.date.getTime() >= startOfUtcDay(now).getTime() &&
            event.date.getTime() < endOfUtcDay(now).getTime(),
        ),
        pendingInsights,
      }),
    ];

    const conflictEventIds = [
      ...new Set(
        drafts
          .filter((draft) => draft.category === "calendar-conflict")
          .flatMap((draft) =>
            Array.isArray(draft.proposedAction?.targetIds)
              ? draft.proposedAction.targetIds.map(String)
              : [],
          ),
      ),
    ];
    const calendarEvidence = await loadCalendarEvidenceIds(conflictEventIds);
    for (const draft of drafts) {
      if (draft.category !== "calendar-conflict") continue;
      const targetIds = Array.isArray(draft.proposedAction?.targetIds)
        ? draft.proposedAction.targetIds.map(String)
        : [];
      draft.triggerEvidenceIds = targetIds
        .map((id) => calendarEvidence.get(id))
        .filter((id): id is string => Boolean(id))
        .slice(0, MAX_TRIGGER_EVIDENCE);
    }

    const existing = await AgentInsight.find({
      idempotencyKey: { $in: drafts.map((draft) => draft.idempotencyKey) },
    })
      .select("idempotencyKey")
      .lean();
    const policy = applyInsightPolicy(drafts, {
      enabledCategories: settings.proactivity.enabledCategories,
      maxInsightsPerDay: settings.proactivity.maxInsightsPerDay,
      createdTodayByCategory,
      existingKeys: new Set(existing.map((insight) => insight.idempotencyKey)),
      categoryFeedback,
    });

    const createdIds: string[] = [];
    for (const draft of policy.accepted) {
      const insight = await AgentInsight.findOneAndUpdate(
        { idempotencyKey: draft.idempotencyKey },
        { $setOnInsert: { ...draft, status: "pending" } },
        { upsert: true, returnDocument: "after" },
      );
      createdIds.push(insight._id.toString());
    }

    run.set({
      status: "completed",
      outputIds: createdIds,
      completedAt: new Date(),
    });
    await run.save();
    return {
      ran: true,
      runId: run._id.toString(),
      created: createdIds.length,
      rejected: policy.rejected,
      expired: expired.modifiedCount,
      woken: woken.modifiedCount,
    } as const;
  } catch (error) {
    run.set({
      status: "failed",
      error:
        error instanceof Error
          ? error.message.slice(0, 4_096)
          : "Unknown error",
      completedAt: new Date(),
    });
    await run.save();
    throw error;
  }
}

export async function processInsightJob(_job: IAgentMemoryJob) {
  return runInsightSweep();
}

export async function scheduleNextInsightJob(now = new Date()) {
  await connectDB();
  const settings = await getAgentMemorySettings();
  if (!settings.releaseGates.proactivity) {
    return { scheduled: false, reason: "proactivity-disabled" } as const;
  }
  const activeJob = await AgentMemoryJob.findOne({
    operation: "insight",
    status: { $in: ["pending", "leased", "retry"] },
  })
    .select("_id")
    .lean();
  if (activeJob) {
    return { scheduled: false, reason: "active-job" } as const;
  }
  const key = `insight:sweep:${now.toISOString().slice(0, 13)}`;
  const existing = await AgentMemoryJob.findOne({ idempotencyKey: key })
    .select("_id")
    .lean();
  if (existing) {
    return { scheduled: false, reason: "already-ran" } as const;
  }
  const job = await AgentMemoryJob.findOneAndUpdate(
    { idempotencyKey: key },
    {
      $setOnInsert: {
        operation: "insight",
        evidenceIds: [],
        memoryIds: [],
        status: "pending",
        attempts: 0,
        availableAt: now,
      },
    },
    { upsert: true, returnDocument: "after" },
  );
  return { scheduled: true, jobId: job._id.toString() } as const;
}

// The inbox shows only actionable insights; dismissed/expired ones leave the
// list (their totals still surface via the status-count aggregate below).
const INBOX_INSIGHT_STATUSES: IAgentInsight["status"][] = [
  "pending",
  "delivered",
  "snoozed",
];

// Contradictions moved out of the insight pipeline into their own inbox panel
// backed by live memory links; legacy memory-contradiction insights would
// double-count until their 7-day expiry, so the list and stats exclude them.
const EXCLUDED_INSIGHT_CATEGORIES = ["memory-contradiction"];

export async function listAgentInsights() {
  await connectDB();
  const [insights, statusCounts] = await Promise.all([
    AgentInsight.find({
      status: { $in: INBOX_INSIGHT_STATUSES },
      category: { $nin: EXCLUDED_INSIGHT_CATEGORIES },
    })
      .sort({ createdAt: -1 })
      .limit(200),
    AgentInsight.aggregate<{ _id: IAgentInsight["status"]; count: number }>([
      { $match: { category: { $nin: EXCLUDED_INSIGHT_CATEGORIES } } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
  ]);
  const stats = {
    pending: 0,
    delivered: 0,
    snoozed: 0,
    dismissed: 0,
    expired: 0,
  };
  for (const entry of statusCounts) {
    if (entry._id in stats)
      stats[entry._id as keyof typeof stats] = entry.count;
  }
  return { insights, stats };
}

export async function actOnAgentInsight(input: {
  insightId: string;
  action: "dismiss" | "snooze" | "useful" | "delivered";
  snoozedUntil?: Date;
  reason?: string;
  now?: Date;
}): Promise<IAgentInsight> {
  await connectDB();
  const insight = mongoose.isValidObjectId(input.insightId)
    ? await AgentInsight.findById(input.insightId)
    : null;
  if (!insight) {
    throw new AgentMemoryPolicyError("Insight not found", "not-found");
  }
  const now = input.now ?? new Date();

  if (input.action === "dismiss") {
    insight.status = "dismissed";
    insight.snoozedUntil = undefined;
  } else if (input.action === "snooze") {
    if (
      !input.snoozedUntil ||
      input.snoozedUntil.getTime() <= now.getTime() ||
      input.snoozedUntil.getTime() >= insight.expiresAt.getTime()
    ) {
      throw new AgentMemoryPolicyError(
        "Snooze must end in the future and before the insight expires",
        "conflict",
      );
    }
    insight.status = "snoozed";
    insight.snoozedUntil = input.snoozedUntil;
  } else if (insight.status === "pending") {
    insight.status = "delivered";
  }
  await insight.save();

  if (input.action === "dismiss" || input.action === "useful") {
    await AgentFeedbackEvent.findOneAndUpdate(
      { idempotencyKey: `insight:${insight._id.toString()}:${input.action}` },
      {
        $setOnInsert: {
          eventId: randomUUID(),
          kind:
            input.action === "useful"
              ? "suggestion-accepted"
              : "suggestion-dismissed",
          memoryIds: [],
          evidenceIds: insight.triggerEvidenceIds.slice(
            0,
            MAX_TRIGGER_EVIDENCE,
          ),
          boundedDiff: {
            insightId: insight._id.toString(),
            category: insight.category,
            action: input.action,
          },
        },
      },
      { upsert: true },
    );
  }

  await AgentAuditEvent.create({
    auditId: randomUUID(),
    action: `insight.${input.action}`,
    actor: "user",
    targetType: "insight",
    targetId: insight._id.toString(),
    reason: input.reason ?? `Owner marked insight as ${input.action}`,
    metadata: { category: insight.category, status: insight.status },
    contentRedacted: false,
    occurredAt: now,
  });

  return insight;
}

export const AGENT_INSIGHT_LIMITS = {
  goalLookaheadDays: GOAL_LOOKAHEAD_DAYS,
  calendarLookaheadDays: CALENDAR_LOOKAHEAD_DAYS,
  followUpStaleDays: FOLLOW_UP_STALE_DAYS,
  failureWindowDays: FAILURE_WINDOW_DAYS,
  repeatedFailureThreshold: REPEATED_FAILURE_THRESHOLD,
  minConfidence: MIN_INSIGHT_CONFIDENCE,
  promptVersion: INSIGHT_PROMPT_VERSION,
  schemaVersion: INSIGHT_SCHEMA_VERSION,
} as const;
