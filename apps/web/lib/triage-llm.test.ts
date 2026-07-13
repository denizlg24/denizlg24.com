import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

// Characterization tests for the three forced-tool triage phases. The LLM is
// mocked at the network layer so these tests survive transport changes: any
// POST that carries a forced tool_choice gets a canned Messages API response.

process.env.AI_GATEWAY_API_KEY ??= "test-gateway-key";

const llmUsageCreateMock = mock(
  async (_entry: Record<string, unknown>) => ({}),
);
mock.module("@/lib/mongodb", () => ({ connectDB: async () => {} }));
mock.module("@/models/LlmUsage", () => ({
  LlmUsage: { create: llmUsageCreateMock },
}));

interface RecordedRequest {
  url: string;
  body: Record<string, unknown>;
}

let recordedRequests: RecordedRequest[] = [];
let nextToolInput: Record<string, unknown> | undefined;
let omitToolUseBlock = false;

const realFetch = globalThis.fetch;

function messageResponse(toolName: string): Response {
  const content = omitToolUseBlock
    ? [{ type: "text", text: "no tool call" }]
    : [{ type: "tool_use", id: "tu_1", name: toolName, input: nextToolInput }];
  return new Response(
    JSON.stringify({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "test-model",
      stop_reason: "tool_use",
      content,
      usage: { input_tokens: 42, output_tokens: 17 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const rawBody =
    input instanceof Request ? await input.text() : String(init?.body ?? "");
  if (rawBody) {
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    recordedRequests.push({ url, body });
    const toolChoice = body.tool_choice as { name?: string } | undefined;
    if (toolChoice?.name) return messageResponse(toolChoice.name);
  }
  throw new Error(`Unexpected fetch in triage tests: ${url}`);
}) as typeof fetch;

afterAll(() => {
  globalThis.fetch = realFetch;
});

const { runPrefilter, runClassification, runExtraction } = await import(
  "./triage"
);
type TriageEmailContext = import("./triage").TriageEmailContext;
type ClassificationResult = import("./triage").ClassificationResult;
type CompactKanbanTarget = import("./triage").CompactKanbanTarget;
type CourseTarget = import("./triage").CourseTarget;

const MODEL = "anthropic/claude-haiku-4.5";

const email: TriageEmailContext = {
  subject: "Project deadline moved",
  from: [{ name: "Alice", address: "alice@example.com" }],
  date: new Date("2026-07-01T10:00:00Z"),
};

function lastRequest(): RecordedRequest {
  const request = recordedRequests.at(-1);
  if (!request) throw new Error("No LLM request recorded");
  return request;
}

beforeEach(() => {
  recordedRequests = [];
  nextToolInput = undefined;
  omitToolUseBlock = false;
  llmUsageCreateMock.mockClear();
});

describe("runPrefilter", () => {
  const emails = [
    { _id: "a", subject: "WIN BIG", from: email.from },
    { _id: "b", subject: "Invoice", from: email.from },
  ];

  test("returns [] without an LLM call when there are no candidates", async () => {
    const result = await runPrefilter(MODEL, []);
    expect(result).toEqual([]);
    expect(recordedRequests).toHaveLength(0);
  });

  test("sends a forced return_spam_ids tool call with bounded max_tokens", async () => {
    nextToolInput = { spamIds: ["a"] };
    await runPrefilter(MODEL, emails);

    const { body } = lastRequest();
    expect(body.model).toBe(MODEL);
    expect(body.temperature).toBe(0);
    expect(body.max_tokens).toBe(80 + emails.length * 40);
    expect(body.tool_choice).toEqual({
      type: "tool",
      name: "return_spam_ids",
      disable_parallel_tool_use: true,
    });
    const tools = body.tools as { name: string }[];
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("return_spam_ids");
  });

  test("keeps only known ids, dedupes, and drops non-strings", async () => {
    nextToolInput = { spamIds: ["a", "a", "zzz", 42, "b"] };
    const result = await runPrefilter(MODEL, emails);
    expect(result).toEqual(["a", "b"]);
  });

  test("returns [] when the model produced no tool_use block", async () => {
    omitToolUseBlock = true;
    const result = await runPrefilter(MODEL, emails);
    expect(result).toEqual([]);
  });

  test("logs usage with the prefilter source", async () => {
    nextToolInput = { spamIds: [] };
    await runPrefilter(MODEL, emails);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(llmUsageCreateMock.mock.calls[0]?.[0]).toMatchObject({
      llmModel: MODEL,
      source: "email-triage-prefilter-v2",
      inputTokens: 42,
      outputTokens: 17,
    });
  });
});

describe("runClassification", () => {
  const body = { text: "Please pay invoice #1", html: "" };

  test("returns coerced classification fields", async () => {
    nextToolInput = {
      category: "action-needed",
      confidence: 0.9,
      summary: "Invoice needs payment",
      needsTaskExtraction: true,
      needsEventExtraction: false,
    };
    const result = await runClassification(MODEL, email, body);
    expect(result).toEqual({
      category: "action-needed",
      confidence: 0.9,
      summary: "Invoice needs payment",
      needsTaskExtraction: true,
      needsEventExtraction: false,
    });

    const { body: requestBody } = lastRequest();
    expect(requestBody.tool_choice).toEqual({
      type: "tool",
      name: "classify_email",
      disable_parallel_tool_use: true,
    });
    expect(requestBody.max_tokens).toBe(220);
  });

  test("coerces invalid values and forces event extraction for scheduled", async () => {
    nextToolInput = {
      category: "scheduled",
      confidence: 7,
      summary: "   ",
      needsTaskExtraction: "yes",
      needsEventExtraction: false,
    };
    const result = await runClassification(MODEL, email, body);
    expect(result).toEqual({
      category: "scheduled",
      confidence: 1,
      summary: email.subject,
      needsTaskExtraction: false,
      needsEventExtraction: true,
    });
  });

  test("falls back to fyi for unknown categories", async () => {
    nextToolInput = { category: "not-a-category" };
    const result = await runClassification(MODEL, email, body);
    expect(result?.category).toBe("fyi");
    expect(result?.confidence).toBe(0.5);
  });

  test("returns null when the model produced no tool_use block", async () => {
    omitToolUseBlock = true;
    const result = await runClassification(MODEL, email, body);
    expect(result).toBeNull();
  });
});

describe("runExtraction", () => {
  const classification: ClassificationResult = {
    category: "action-needed",
    confidence: 0.9,
    summary: "s",
    needsTaskExtraction: true,
    needsEventExtraction: true,
  };
  const kanbanTargets: CompactKanbanTarget[] = [
    {
      key: "K1",
      boardId: "board-1",
      boardTitle: "Uni",
      columnId: "col-1",
      columnTitle: "Todo",
    },
  ];
  const courseTargets: CourseTarget[] = [
    {
      key: "C1",
      courseId: "course-1",
      name: "Databases",
      triageContext: [],
      boardIds: [],
      deadlines: [
        {
          key: "D1",
          deadlineId: "deadline-1",
          title: "HW1",
          dueAt: "2026-07-10",
        },
      ],
      events: [
        { key: "E1", eventId: "event-1", title: "Exam", date: "2026-07-20" },
      ],
    },
  ];
  const emptyBody = { text: "body", html: "" };

  test("parses tasks and events, resolving kanban and course keys", async () => {
    nextToolInput = {
      tasks: [
        {
          title: "Pay invoice",
          priority: "not-a-priority",
          dueDate: "2026-07-05T12:00:00Z",
          kanbanTargetKey: "K1",
        },
        {
          title: "Update HW deadline",
          priority: "high",
          updatesDeadlineKey: "D1",
        },
      ],
      events: [
        { title: "Exam", date: "2026-07-20T09:00:00Z", updatesEventKey: "E1" },
        { title: "No date event", date: "not-a-date" },
      ],
      courseKey: "C1",
    };

    const result = await runExtraction(
      MODEL,
      email,
      emptyBody,
      classification,
      kanbanTargets,
      courseTargets,
      undefined,
    );

    expect(result).not.toBeNull();
    expect(result?.tasks).toHaveLength(2);
    expect(result?.tasks[0]).toMatchObject({
      title: "Pay invoice",
      priority: "medium",
      kanbanBoardId: "board-1",
      kanbanBoardTitle: "Uni",
      kanbanColumnId: "col-1",
      kanbanColumnTitle: "Todo",
      courseId: "course-1",
      courseName: "Databases",
    });
    expect(result?.tasks[1]).toMatchObject({
      priority: "high",
      updatesCourseDeadlineId: "deadline-1",
      courseId: "course-1",
    });
    // The invalid-date event is dropped.
    expect(result?.events).toHaveLength(1);
    expect(result?.events[0]).toMatchObject({
      title: "Exam",
      updatesCalendarEventId: "event-1",
      courseId: "course-1",
    });
    expect(result?.matchedCourseId).toBe("course-1");
    expect(result?.matchedCourseName).toBe("Databases");

    const { body: requestBody } = lastRequest();
    expect(requestBody.tool_choice).toEqual({
      type: "tool",
      name: "extract_triage_details",
      disable_parallel_tool_use: true,
    });
  });

  test("a deterministic course match wins over the model's courseKey", async () => {
    nextToolInput = {
      tasks: [{ title: "T", priority: "low" }],
      events: [],
      courseKey: "C1",
    };
    const deterministic: CourseTarget = {
      ...courseTargets[0],
      key: "C9",
      courseId: "course-9",
      name: "Networks",
    };
    const result = await runExtraction(
      MODEL,
      email,
      emptyBody,
      classification,
      kanbanTargets,
      [...courseTargets, deterministic],
      deterministic,
    );
    expect(result?.tasks[0]).toMatchObject({ courseId: "course-9" });
    expect(result?.matchedCourseId).toBe("course-9");
  });

  test("ignores tasks when classification did not request task extraction", async () => {
    nextToolInput = {
      tasks: [{ title: "Should be ignored" }],
      events: [],
    };
    const result = await runExtraction(
      MODEL,
      email,
      emptyBody,
      { ...classification, needsTaskExtraction: false },
      kanbanTargets,
      [],
      undefined,
    );
    expect(result?.tasks).toEqual([]);
  });

  test("returns null when the model produced no tool_use block", async () => {
    omitToolUseBlock = true;
    const result = await runExtraction(
      MODEL,
      email,
      emptyBody,
      classification,
      kanbanTargets,
      [],
      undefined,
    );
    expect(result).toBeNull();
  });
});
