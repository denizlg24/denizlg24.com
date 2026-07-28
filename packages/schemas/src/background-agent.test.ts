import { describe, expect, test } from "bun:test";
import {
  backgroundAgentRunResponseSchema,
  backgroundAgentRunSchema,
  createBackgroundAgentRunSchema,
} from "./background-agent";

describe("background agent contracts", () => {
  test("accepts a page-aware queued run", () => {
    expect(
      createBackgroundAgentRunSchema.parse({
        prompt: "Update the item visible on this page",
        model: "anthropic/claude-sonnet-4.6",
        pageContext: {
          pathname: "/dashboard/kanban",
          title: "Kanban",
          selection: "Ship agent sheet",
          details: { visibleText: "In progress" },
        },
      }).pageContext?.pathname,
    ).toBe("/dashboard/kanban");

    expect(
      backgroundAgentRunSchema.parse({
        id: "run-1",
        conversationId: "conversation-1",
        prompt: "Do the work",
        model: "anthropic/claude-sonnet-4.6",
        status: "queued",
        attachments: [],
        createdAt: "2026-07-28T10:00:00.000Z",
        updatedAt: "2026-07-28T10:00:00.000Z",
      }).status,
    ).toBe("queued");
    expect(
      backgroundAgentRunResponseSchema.parse({
        run: {
          id: "run-1",
          conversationId: "conversation-1",
          prompt: "Do the work",
          model: "anthropic/claude-sonnet-4.6",
          status: "queued",
          attachments: [],
          createdAt: "2026-07-28T10:00:00.000Z",
          updatedAt: "2026-07-28T10:00:00.000Z",
        },
      }).run.id,
    ).toBe("run-1");
  });

  test("rejects non-dashboard-sized or empty work requests", () => {
    expect(
      createBackgroundAgentRunSchema.safeParse({
        prompt: "",
        model: "anthropic/claude-sonnet-4.6",
      }).success,
    ).toBe(false);
    expect(
      createBackgroundAgentRunSchema.safeParse({
        prompt: "work",
        model: "anthropic/claude-sonnet-4.6",
        maxRounds: 101,
      }).success,
    ).toBe(false);
  });

  test("accepts attachment-only background work", () => {
    expect(
      createBackgroundAgentRunSchema.parse({
        model: "anthropic/claude-sonnet-4.6",
        attachments: [
          {
            type: "image",
            url: "https://storage.example/photo.jpg",
            name: "photo.jpg",
          },
        ],
      }).prompt,
    ).toBe("");
  });
});
