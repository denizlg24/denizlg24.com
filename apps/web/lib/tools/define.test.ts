import { describe, expect, it } from "bun:test";
import { z } from "zod";

import { contactsTools } from "./contacts";
import { defineTool, ToolInputError } from "./define";
import { emailTools } from "./email";
import { kanbanTools } from "./kanban";
import { marketsTools } from "./markets";
import { nowTools } from "./now";
import { resourceTools } from "./resources";
import { todayBoardTools } from "./today-board";
import { whiteboardTools } from "./whiteboard";

const tool = defineTool({
  name: "update_thing",
  description: "Update a thing.",
  isWrite: true,
  category: "test",
  input: z.object({
    id: z.string().describe("The thing id"),
    status: z
      .enum(["open", "closed"])
      .optional()
      .describe("New status, unchanged when omitted"),
    limit: z.number().int().min(1).max(50).default(10).describe("How many"),
  }),
  execute: async (input) => input,
});

describe("defineTool", () => {
  it("derives the advertised schema from the zod object", () => {
    expect(tool.schema.input_schema).toEqual({
      type: "object",
      properties: {
        id: { type: "string", description: "The thing id" },
        status: {
          description: "New status, unchanged when omitted",
          type: "string",
          enum: ["open", "closed"],
        },
        limit: {
          default: 10,
          description: "How many",
          type: "integer",
          minimum: 1,
          maximum: 50,
        },
      },
      required: ["id"],
    });
  });

  it("applies declared defaults before the handler sees the input", async () => {
    expect(await tool.execute?.({ id: "a" })).toEqual({ id: "a", limit: 10 });
  });

  /**
   * The whole point of the gate. A message that does not name the field leaves
   * the model reissuing the identical arguments, which is the failure this was
   * built to stop.
   */
  it("names the field, the expectation and what arrived", async () => {
    const failure = await tool
      .execute?.({ status: "done", limit: 500 })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ToolInputError);
    const message = (failure as Error).message;
    expect(message).toContain("Invalid input for update_thing");
    expect(message).toContain("id:");
    expect(message).toContain("received nothing");
    expect(message).toContain('received "done"');
    expect(message).toContain("received 500");
  });

  it("reports every bad field at once rather than the first", async () => {
    const failure = (await tool
      .execute?.({ id: 5, status: "done" })
      .catch((error: unknown) => error)) as ToolInputError;

    expect(failure.issues.map((issue) => issue.path.join("."))).toEqual([
      "id",
      "status",
    ]);
  });
});

/**
 * The registry itself cannot be imported here — it reaches `server-only`
 * through the spreadsheet tools — so the sweep covers the modules this pass
 * converted, which is where an unrepresentable zod schema would come from.
 */
describe("the converted tool modules", () => {
  const converted = [
    ...contactsTools,
    ...emailTools,
    ...kanbanTools,
    ...marketsTools,
    ...nowTools,
    ...resourceTools,
    ...todayBoardTools,
    ...whiteboardTools,
  ];

  /**
   * A schema the API rejects fails the whole turn, not one call, and nothing
   * else in the build looks at these objects.
   */
  it("advertises a well-formed input schema for every tool", () => {
    for (const { schema } of converted) {
      expect(schema.name).toMatch(/^[a-z0-9_]+$/);
      expect(schema.description.length).toBeGreaterThan(0);
      expect(schema.input_schema.type).toBe("object");
      expect(typeof schema.input_schema.properties).toBe("object");
      for (const field of schema.input_schema.required ?? []) {
        expect(Object.keys(schema.input_schema.properties)).toContain(field);
      }
    }
  });
});
