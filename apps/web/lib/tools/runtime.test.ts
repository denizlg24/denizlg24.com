import { describe, expect, mock, test } from "bun:test";

mock.module("@/lib/timezone", () => ({
  getAppTimeZone: async () => "Europe/Lisbon",
}));

const { runtimeTools } = await import("./runtime");

const tool = (name: string) => {
  const found = runtimeTools.find((t) => t.schema.name === name);
  if (!found?.execute) throw new Error(`${name} is not registered`);
  return found.execute;
};

describe("get_day", () => {
  test("reports the wall clock in the owner's timezone", async () => {
    const result = (await tool("get_day")({})) as Record<string, unknown>;
    expect(result.success).toBe(true);
    expect(result.timeZone).toBe("Europe/Lisbon");
    expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.time).toMatch(/^\d{2}:\d{2}$/);
    expect(result.utc).toBe(new Date(result.epochMs as number).toISOString());
    expect(result.weekdayNumber).toBeGreaterThanOrEqual(1);
    expect(result.weekdayNumber).toBeLessThanOrEqual(7);
    expect(result.isWeekend).toBe(
      result.weekday === "Saturday" || result.weekday === "Sunday",
    );
  });

  test("the reported date is the one that timezone is on", async () => {
    const result = (await tool("get_day")({})) as { date: string };
    const expected = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Lisbon",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    expect(result.date).toBe(expected);
  });
});

describe("get_running_context", () => {
  test("an interactive chat turn is attended and needs approval", async () => {
    const result = (await tool("get_running_context")(
      {},
      {
        conversationId: "conv1",
        memoryMode: "enabled",
        run: {
          surface: "user-chat",
          unattended: false,
          executionMode: "interactive",
          clientToolsAvailable: true,
        },
      },
    )) as Record<string, unknown>;
    expect(result.surface).toBe("user-chat");
    expect(result.unattended).toBe(false);
    expect(result.writesNeedApproval).toBe(true);
    expect(result.conversationId).toBe("conv1");
    expect(result.task).toBeUndefined();
  });

  test("a scheduled run reports the task and that nobody is present", async () => {
    const result = (await tool("get_running_context")(
      {},
      {
        memoryMode: "enabled",
        run: {
          surface: "scheduled-task",
          unattended: true,
          executionMode: "yolo",
          clientToolsAvailable: false,
          task: {
            id: "t1",
            runId: "r1",
            name: "Nightly sweep",
            origin: "agent",
            cron: "0 3 * * *",
            timeZone: "Europe/Lisbon",
          },
        },
      },
    )) as Record<string, unknown>;
    expect(result.surface).toBe("scheduled-task");
    expect(result.unattended).toBe(true);
    expect(result.writesNeedApproval).toBe(false);
    expect(result.clientToolsAvailable).toBe(false);
    expect(result.task).toMatchObject({ origin: "agent", cron: "0 3 * * *" });
  });

  test("an entry point that reports nothing degrades instead of failing", async () => {
    const result = (await tool("get_running_context")({})) as Record<
      string,
      unknown
    >;
    expect(result.success).toBe(true);
    expect(result.surface).toBe("unknown");
  });
});
