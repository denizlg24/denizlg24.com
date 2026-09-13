import { describe, expect, test } from "bun:test";
import {
  boundConnectorResult,
  connectorInputSchemaForModel,
  exposedToolName,
} from "./toolset";

describe("exposedToolName", () => {
  test("namespaces by connector and stays within 64 characters", () => {
    expect(exposedToolName("denizlg24", "web_notes")).toBe(
      "denizlg24__web_notes",
    );
    const long = exposedToolName(
      "some-long-connector",
      "an_extremely_long_tool_name_that_keeps_going_and_going_forever",
    );
    expect(long.length).toBeLessThanOrEqual(64);
    expect(long).toMatch(/^some-long-connector__/);
    expect(long).not.toBe(
      exposedToolName(
        "some-long-connector",
        "an_extremely_long_tool_name_that_keeps_going_and_going_forever_2",
      ),
    );
  });
});

describe("boundConnectorResult", () => {
  test("keeps text and images, drops the structuredContent duplicate", () => {
    const result = boundConnectorResult({
      content: [
        { type: "text", text: "hello" },
        { type: "image", data: "AAAA", mimeType: "image/png" },
      ],
      structuredContent: { hello: true },
    });
    expect(result).toEqual({
      content: [
        { type: "text", text: "hello" },
        { type: "image", mimeType: "image/png", data: "AAAA" },
      ],
    });
  });

  test("falls back to structuredContent when content is empty", () => {
    expect(
      boundConnectorResult({ content: [], structuredContent: { a: 1 } }),
    ).toEqual({ content: [{ type: "text", text: '{"a":1}' }] });
  });

  test("truncates past the budget and says so", () => {
    const result = boundConnectorResult({
      content: [{ type: "text", text: "x".repeat(60_000) }],
    });
    expect(result.truncated).toBe(true);
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect(
      result.content[0]?.type === "text" && result.content[0].text.length,
    ).toBe(48_000);
    expect(result.content.at(-1)).toMatchObject({
      text: expect.stringContaining("truncated"),
    });
  });
});

describe("connectorInputSchemaForModel", () => {
  const schema = {
    type: "object" as const,
    properties: {
      env: {
        type: "object" as const,
        propertyNames: { type: "string" as const, minLength: 1 },
        additionalProperties: { type: "string" as const },
      },
    },
  };

  test("removes unsupported propertyNames recursively for OpenAI", () => {
    expect(connectorInputSchemaForModel(schema, "openai/gpt-5.6-luna")).toEqual(
      {
        type: "object",
        properties: {
          env: {
            type: "object",
            additionalProperties: { type: "string" },
          },
        },
      },
    );
    expect(schema.properties.env.propertyNames).toBeDefined();
  });

  test("preserves the MCP schema for providers that support it", () => {
    expect(
      connectorInputSchemaForModel(schema, "anthropic/claude-opus-4.7"),
    ).toBe(schema);
  });
});
