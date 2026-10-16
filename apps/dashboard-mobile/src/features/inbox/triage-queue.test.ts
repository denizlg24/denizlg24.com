import { describe, expect, test } from "bun:test";
import type { IEmailTriage } from "@repo/schemas";
import { pendingSuggestions } from "./triage-queue";

function row(
  id: string,
  category: IEmailTriage["category"],
  triagedAt: string,
  extra: Partial<IEmailTriage> = {},
): IEmailTriage {
  return {
    _id: id,
    emailId: `e-${id}`,
    accountId: "a",
    stage: "full",
    category,
    confidence: 1,
    reviewRequired: false,
    attachmentTextUsed: false,
    attachmentTextSources: [],
    suggestedTasks: [],
    suggestedEvents: [],
    suggestedActions: [],
    userStatus: "pending",
    modelUsed: "m",
    triagedAt,
    email: {
      subject: `Subject ${id}`,
      from: [{ name: "Ana", address: "ana@x.dk" }],
      date: triagedAt,
    },
    ...extra,
  };
}

describe("pendingSuggestions", () => {
  test("keeps only pending ones, urgent categories first, newest first", () => {
    const queue = pendingSuggestions([
      row("fyi", "fyi", "2026-10-16T10:00:00Z", {
        suggestedTasks: [
          { _id: "t1", title: "Read", priority: "low", status: "pending" },
        ],
      }),
      row("old", "action-needed", "2026-10-14T10:00:00Z", {
        suggestedEvents: [
          {
            _id: "e1",
            title: "Meeting",
            date: "2026-10-20",
            status: "pending",
          },
          { _id: "e2", title: "Done", date: "2026-10-20", status: "accepted" },
        ],
      }),
      row("new", "action-needed", "2026-10-15T10:00:00Z", {
        suggestedActions: [
          {
            _id: "a1",
            tool: "web_people",
            arguments: {},
            summary: "Update Ana's phone",
            effect: "update",
            status: "pending",
          },
        ],
      }),
    ]);
    expect(queue.map((item) => item.key)).toEqual([
      "new:a1",
      "old:e1",
      "fyi:t1",
    ]);
    expect(queue[0]).toMatchObject({
      type: "action",
      title: "Update Ana's phone",
      sender: "Ana",
    });
  });
});
