import { describe, expect, test } from "bun:test";
import {
  createAgentTaskFeedbackSchema,
  createAgentTaskSchema,
} from "./agent-tasks";

describe("agent task contracts", () => {
  test("defaults an unscheduled task to full memory", () => {
    expect(
      createAgentTaskSchema.parse({
        name: "Portfolio review",
        prompt: "Review the portfolio and flag anything unusual.",
      }),
    ).toMatchObject({ attachments: [], memoryMode: "enabled" });
  });

  test("accepts a cron schedule with a time zone", () => {
    expect(
      createAgentTaskSchema.parse({
        name: "Market open",
        prompt: "Summarise overnight moves.",
        schedule: { cron: "30 9 * * 1-5", timeZone: "America/New_York" },
      }).schedule,
    ).toMatchObject({ cron: "30 9 * * 1-5" });
  });

  test("rejects a cron expression that is not five fields", () => {
    expect(
      createAgentTaskSchema.safeParse({
        name: "Broken",
        prompt: "Nothing.",
        schedule: { cron: "0 9 * *", timeZone: "UTC" },
      }).success,
    ).toBe(false);
  });

  test("rejects an invalid time zone", () => {
    expect(
      createAgentTaskSchema.safeParse({
        name: "Broken",
        prompt: "Nothing.",
        schedule: { cron: "0 9 * * *", timeZone: "Mars/Olympus" },
      }).success,
    ).toBe(false);
  });

  test("requires text on every verdict, not just corrections", () => {
    for (const verdict of ["useful", "correction"] as const) {
      expect(
        createAgentTaskFeedbackSchema.safeParse({
          feedbackId: crypto.randomUUID(),
          verdict,
        }).success,
      ).toBe(false);
    }
  });
});
