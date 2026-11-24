import { describe, expect, test } from "bun:test";
import type { AgentUIMessage } from "@repo/schemas";
import { resolveHistory } from "./history";
import { AgentMergeError } from "./merge";

const user: AgentUIMessage = {
  id: "u1",
  role: "user",
  parts: [{ type: "text", text: "hi" }],
};
const reply: AgentUIMessage = {
  id: "a1",
  role: "assistant",
  parts: [{ type: "text", text: "hello", state: "done" }],
};
const asking: AgentUIMessage = {
  id: "a2",
  role: "assistant",
  parts: [
    { type: "step-start" },
    {
      type: "tool-ask_user",
      toolCallId: "q1",
      state: "input-available",
      input: {
        questions: [
          {
            id: "scope",
            question: "Which?",
            options: [{ label: "A" }, { label: "B" }],
          },
        ],
      },
    },
  ],
};

describe("resolveHistory", () => {
  test("appends a new user message", () => {
    const next: AgentUIMessage = {
      id: "u2",
      role: "user",
      parts: [{ type: "text", text: "more" }],
    };
    const { history, newUserText } = resolveHistory([user, reply], {
      trigger: "submit-message",
      message: next,
    });
    expect(history.map((message) => message.id)).toEqual(["u1", "a1", "u2"]);
    expect(newUserText).toBe("more");
  });

  test("the stored last user message sent again is a retry, not a copy", () => {
    const { history, newUserText } = resolveHistory([reply, user], {
      trigger: "submit-message",
      message: user,
    });
    expect(history.map((message) => message.id)).toEqual(["a1", "u1"]);
    expect(newUserText).toBe("hi");
  });

  test("a new message is refused while a question is open", () => {
    expect(() =>
      resolveHistory([user, asking], {
        trigger: "submit-message",
        message: {
          id: "u3",
          role: "user",
          parts: [{ type: "text", text: "x" }],
        },
      }),
    ).toThrow(AgentMergeError);
  });

  test("an answer continues the same assistant message", () => {
    const answered: AgentUIMessage = {
      ...asking,
      parts: [
        { type: "step-start" },
        {
          type: "tool-ask_user",
          toolCallId: "q1",
          state: "output-available",
          input: {},
          output: { answers: [{ id: "scope", selected: ["B"] }] },
        },
      ],
    };
    const { history, newUserText } = resolveHistory([user, asking], {
      trigger: "submit-message",
      message: answered,
    });
    expect(newUserText).toBeNull();
    expect(history).toHaveLength(2);
    expect(history[1]?.id).toBe("a2");
    expect(history[1]?.parts[1]).toMatchObject({
      state: "output-available",
      output: { answers: [{ id: "scope", selected: ["B"] }] },
      // The stored input stands, not the client's copy.
      input: { questions: [{ id: "scope" }] },
    });
  });

  test("a malformed answer reads as a skip", () => {
    const { history } = resolveHistory([user, asking], {
      trigger: "submit-message",
      message: {
        ...asking,
        parts: [
          {
            type: "tool-ask_user",
            toolCallId: "q1",
            state: "output-available",
            input: {},
            output: { answers: "everything" },
          },
        ],
      },
    });
    expect(history[1]?.parts[1]).toMatchObject({
      output: { dismissed: true },
    });
  });
});

describe("resolveHistory refuses a message already answered", () => {
  test("a queue head dispatched twice is a 409, not a second turn", () => {
    expect(() =>
      resolveHistory([user, reply], {
        trigger: "submit-message",
        message: user,
      }),
    ).toThrow(AgentMergeError);
  });

  test("the unanswered last message is still a retry", () => {
    const { history } = resolveHistory([reply, user], {
      trigger: "submit-message",
      message: user,
    });
    expect(history.map((message) => message.id)).toEqual(["a1", "u1"]);
  });
});
