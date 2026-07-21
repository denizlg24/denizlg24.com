import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  type AgentInsightDraft,
  applyInsightPolicy,
  buildDailyBriefing,
  calendarConflictInsights,
  categoryPreference,
  dayKey,
  goalDeadlineInsights,
  type InsightCalendarEventInput,
  type InsightGoalInput,
  isoWeekKey,
  repeatedFailureInsights,
  staleFollowUpInsights,
} from "./insights";

const NOW = new Date("2026-07-13T09:00:00.000Z");
const TZ = "Europe/Lisbon";

function goal(overrides: Partial<InsightGoalInput> = {}): InsightGoalInput {
  return {
    id: "goal-1",
    title: "Finish Calculus II revision",
    kind: "goal",
    status: "active",
    targetUntil: new Date("2026-07-16T18:00:00.000Z"),
    updatedAt: new Date("2026-07-12T10:00:00.000Z"),
    progressEvidenceIds: ["7ef113ee-c6d7-4b2d-b79f-b676eb2eb7eb"],
    ...overrides,
  };
}

function calendarEvent(
  overrides: Partial<InsightCalendarEventInput> = {},
): InsightCalendarEventInput {
  return {
    id: "event-a",
    title: "Team sync",
    date: new Date("2026-07-14T10:00:00.000Z"),
    endDate: new Date("2026-07-14T11:00:00.000Z"),
    isAllDay: false,
    status: "scheduled",
    suppressed: false,
    ...overrides,
  };
}

function draft(overrides: Partial<AgentInsightDraft> = {}): AgentInsightDraft {
  return {
    idempotencyKey: "insight:goal-deadline:goal-1:2026-07-16",
    category: "goal-deadline",
    title: "Goal deadline approaching",
    body: "Body",
    triggerEvidenceIds: [],
    reason: "Reason",
    expectedUsefulness: 0.75,
    urgency: 0.6,
    confidence: 0.9,
    interruptionCost: 0.2,
    expiresAt: new Date("2026-07-16T18:00:00.000Z"),
    ...overrides,
  };
}

describe("Gate F deterministic triggers", () => {
  test("raises an approaching goal deadline inside the lookahead window", () => {
    const drafts = goalDeadlineInsights(NOW, [goal()], TZ);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.idempotencyKey).toBe(
      "insight:goal-deadline:goal-1:2026-07-16",
    );
    expect(drafts[0]?.expiresAt).toEqual(new Date("2026-07-16T18:00:00.000Z"));
    expect(drafts[0]?.urgency).toBeGreaterThan(0.4);
    expect(drafts[0]?.triggerEvidenceIds).toEqual([
      "7ef113ee-c6d7-4b2d-b79f-b676eb2eb7eb",
    ]);
  });

  test("ignores distant, past, and non-active goal deadlines", () => {
    expect(
      goalDeadlineInsights(
        NOW,
        [
          goal({ targetUntil: new Date("2026-08-30T00:00:00.000Z") }),
          goal({
            id: "goal-2",
            targetUntil: new Date("2026-07-10T00:00:00.000Z"),
          }),
          goal({ id: "goal-3", status: "paused" }),
          goal({ id: "goal-4", targetUntil: undefined }),
        ],
        TZ,
      ),
    ).toHaveLength(0);
  });

  test("detects overlapping calendar events with an order-independent key", () => {
    const overlap = calendarEvent({
      id: "event-b",
      title: "Dentist",
      date: new Date("2026-07-14T10:30:00.000Z"),
      endDate: new Date("2026-07-14T11:30:00.000Z"),
    });
    const drafts = calendarConflictInsights(
      NOW,
      [overlap, calendarEvent()],
      TZ,
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.idempotencyKey).toBe(
      "insight:calendar-conflict:event-a:event-b",
    );
    const reversed = calendarConflictInsights(
      NOW,
      [calendarEvent(), overlap],
      TZ,
    );
    expect(reversed[0]?.idempotencyKey).toBe(drafts[0]?.idempotencyKey);
  });

  test("does not flag back-to-back, all-day, or suppressed events", () => {
    expect(
      calendarConflictInsights(
        NOW,
        [
          calendarEvent(),
          calendarEvent({
            id: "event-b",
            date: new Date("2026-07-14T11:00:00.000Z"),
            endDate: new Date("2026-07-14T12:00:00.000Z"),
          }),
          calendarEvent({ id: "event-c", isAllDay: true }),
          calendarEvent({ id: "event-d", suppressed: true }),
        ],
        TZ,
      ),
    ).toHaveLength(0);
  });

  test("raises stale agent follow-ups only after the stale window", () => {
    const stale = goal({
      id: "goal-5",
      kind: "agent-follow-up",
      updatedAt: new Date("2026-07-08T10:00:00.000Z"),
    });
    const fresh = goal({
      id: "goal-6",
      kind: "agent-follow-up",
      updatedAt: new Date("2026-07-12T10:00:00.000Z"),
    });
    const drafts = staleFollowUpInsights(NOW, [stale, fresh], TZ);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.idempotencyKey).toBe(
      "insight:follow-up:goal-5:2026-07-08T10:00:00.000Z",
    );
  });

  test("raises repeated failures only at the threshold inside the window", () => {
    const failure = (daysAgo: number, toolName: string) => ({
      createdAt: new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1_000),
      toolName,
      evidenceIds: [],
    });
    const drafts = repeatedFailureInsights(NOW, [
      failure(1, "email-send"),
      failure(2, "email-send"),
      failure(3, "email-send"),
      failure(1, "calendar-write"),
      failure(2, "calendar-write"),
      failure(10, "calendar-write"),
    ]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.idempotencyKey).toBe(
      `insight:repeated-failure:email-send:${isoWeekKey(NOW)}`,
    );
  });

  test("builds one deterministic daily briefing per local day", () => {
    const briefing = buildDailyBriefing(
      NOW,
      {
        goalsDueSoon: [goal()],
        todaysEvents: [
          calendarEvent({ date: new Date("2026-07-13T15:00:00.000Z") }),
        ],
        pendingInsights: 2,
      },
      TZ,
    );
    expect(briefing.idempotencyKey).toBe("insight:daily-briefing:2026-07-13");
    expect(briefing.expiresAt).toEqual(new Date("2026-07-13T23:00:00.000Z"));
    expect(briefing.body).toContain("Team sync");
    expect(briefing.body).toContain("Finish Calculus II revision");
    expect(briefing.body).toContain("2 insight(s) waiting");
    expect(dayKey(NOW, TZ)).toBe("2026-07-13");
  });
});

describe("Gate F insight policy", () => {
  const baseOptions = {
    enabledCategories: [] as string[],
    maxInsightsPerDay: 5,
    createdTodayByCategory: {},
    existingKeys: new Set<string>(),
    categoryFeedback: {},
  };

  test("empty enabledCategories means default-on; a list narrows delivery", () => {
    const open = applyInsightPolicy([draft()], baseOptions);
    expect(open.accepted).toHaveLength(1);

    const narrowed = applyInsightPolicy([draft()], {
      ...baseOptions,
      enabledCategories: ["daily-briefing"],
    });
    expect(narrowed.accepted).toHaveLength(0);
    expect(narrowed.rejected[0]?.reason).toBe("category-disabled");
  });

  test("abstains below the confidence floor", () => {
    const result = applyInsightPolicy(
      [draft({ confidence: 0.2 })],
      baseOptions,
    );
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected[0]?.reason).toBe("low-confidence");
  });

  test("suppresses duplicates by idempotency key", () => {
    const result = applyInsightPolicy([draft()], {
      ...baseOptions,
      existingKeys: new Set([draft().idempotencyKey]),
    });
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected[0]?.reason).toBe("duplicate");
  });

  test("rate-limits per category per day, counting within the batch", () => {
    const result = applyInsightPolicy(
      [
        draft(),
        draft({ idempotencyKey: "insight:goal-deadline:goal-2:2026-07-17" }),
      ],
      { ...baseOptions, maxInsightsPerDay: 1 },
    );
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected[0]?.reason).toBe("rate-limited");

    const exhausted = applyInsightPolicy([draft()], {
      ...baseOptions,
      maxInsightsPerDay: 1,
      createdTodayByCategory: { "goal-deadline": 1 },
    });
    expect(exhausted.rejected[0]?.reason).toBe("rate-limited");
  });

  test("prepares a silent draft instead of interrupting when preference is low", () => {
    const dismissedHeavy = {
      "goal-deadline": { accepted: 0, dismissed: 8 },
    };
    expect(categoryPreference("goal-deadline", dismissedHeavy)).toBeCloseTo(
      0.1,
    );

    const quiet = applyInsightPolicy(
      [draft({ expectedUsefulness: 0.6, urgency: 0.4, interruptionCost: 0.2 })],
      { ...baseOptions, categoryFeedback: dismissedHeavy },
    );
    expect(quiet.accepted[0]?.delivery).toBe("silent-draft");

    const loud = applyInsightPolicy(
      [draft({ expectedUsefulness: 0.8, urgency: 0.9, interruptionCost: 0.3 })],
      baseOptions,
    );
    expect(loud.accepted[0]?.delivery).toBe("in-app");
  });

  test("the daily briefing is always delivered in-app", () => {
    const result = applyInsightPolicy(
      [
        draft({
          idempotencyKey: "insight:daily-briefing:2026-07-13",
          category: "daily-briefing",
          expectedUsefulness: 0.1,
          urgency: 0.1,
          interruptionCost: 0.9,
          confidence: 1,
        }),
      ],
      baseOptions,
    );
    expect(result.accepted[0]?.delivery).toBe("in-app");
  });
});

describe("Gate F execution boundary", () => {
  test("the insight engine cannot reach tools, LLMs, or external channels", () => {
    const source = readFileSync(
      new URL("./insights.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toContain("@/lib/tools");
    expect(source).not.toContain("llm-service");
    expect(source).not.toContain("llm-chat");
    expect(source).not.toContain('from "ai"');
    expect(source).not.toContain("@/lib/email");
    expect(source).not.toContain("@/lib/smtp");
    expect(source).not.toContain("@/lib/resend");
    expect(source).not.toContain("send-contact-to-slack");
  });
});
