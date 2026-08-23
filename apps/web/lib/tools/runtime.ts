import { getAppTimeZone } from "@/lib/timezone";
import type { AgentRunContext, ToolDefinition } from "./types";

/**
 * The system prompt states the date once, when the turn opens. That is stale
 * by the time a long agentic run reaches its last tool call, and it is not
 * stated at all in a prompt the model is reasoning about hours later, so the
 * clock has to be readable on demand.
 */
function describeNow(timeZone: string, now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";

  const year = part("year");
  const month = part("month");
  const day = part("day");
  const hour = part("hour");
  const minute = part("minute");
  const second = part("second");
  const weekday = part("weekday");

  const numeric = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  return {
    timeZone,
    abbreviation: part("timeZoneName"),
    weekday,
    /** ISO weekday, Monday = 1, so scheduling maths does not parse the name. */
    weekdayNumber:
      [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
      ].indexOf(weekday) || 7,
    date: numeric,
    day: Number(day),
    month,
    monthNumber: Number(numeric.slice(5, 7)),
    year: Number(year),
    time: `${hour}:${minute}`,
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
    isWeekend: weekday === "Saturday" || weekday === "Sunday",
    /** Wall-clock reading in the owner's zone, as the owner would say it. */
    readable: `${weekday}, ${month} ${Number(day)}, ${year} at ${hour}:${minute} ${part("timeZoneName")}`,
    utc: now.toISOString(),
    epochMs: now.getTime(),
  };
}

const SURFACE_NOTES: Record<AgentRunContext["surface"], string> = {
  "user-chat": "Deniz is in the chat now and can answer a question.",
  "user-voice":
    "Deniz is speaking to you. Answers are read aloud, so keep them to one or two plain-text sentences.",
  "background-agent":
    "Started from a dashboard page and running detached. Deniz is not watching the stream; the result is read afterwards.",
  "scheduled-task":
    "A recurring scheduled run. Nobody is present — nothing can be asked and then answered, and the run has no memory of any conversation.",
  "one-off-task":
    "A single scheduled firing. Nobody is present — nothing can be asked and then answered.",
  "manual-task-run":
    "A saved task Deniz triggered by hand. It runs unattended like any other task run.",
};

export const runtimeTools: ToolDefinition[] = [
  {
    schema: {
      name: "get_day",
      description:
        "Get the current day, date and time in Deniz's timezone. Use it whenever the answer depends on the wall clock — what day it is, whether something is overdue, how long until a deadline, or building a date for another tool — rather than relying on the date in your instructions, which was stamped when the turn opened.",
      input_schema: { type: "object", properties: {} },
    },
    isWrite: false,
    category: "runtime",
    execute: async () => {
      const timeZone = await getAppTimeZone();
      return { success: true, ...describeNow(timeZone, new Date()) };
    },
  },
  {
    schema: {
      name: "get_running_context",
      description:
        "Get which surface this turn is running on: an interactive chat, a voice reply, a detached background run, or an unattended task firing (scheduled, one-off, or triggered by hand). Tells you whether anyone is present to answer a question, whether writes need approval, whether desktop page tools are reachable, and — for a task — who scheduled it. Check it before asking a clarifying question or deferring work to later.",
      input_schema: { type: "object", properties: {} },
    },
    isWrite: false,
    category: "runtime",
    execute: async (_input, context) => {
      const run = context?.run;
      if (!run) {
        return {
          success: true,
          surface: "unknown",
          note: "This entry point does not report a running context.",
        };
      }
      return {
        success: true,
        surface: run.surface,
        unattended: run.unattended,
        executionMode: run.executionMode,
        writesNeedApproval: run.executionMode === "interactive",
        clientToolsAvailable: run.clientToolsAvailable,
        ...(context?.memoryMode ? { memoryMode: context.memoryMode } : {}),
        ...(context?.conversationId
          ? { conversationId: context.conversationId }
          : {}),
        ...(run.task ? { task: run.task } : {}),
        note: SURFACE_NOTES[run.surface],
      };
    },
  },
];
