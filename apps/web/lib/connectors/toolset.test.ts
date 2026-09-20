import { describe, expect, mock, test } from "bun:test";
import type { ListToolsResult } from "@ai-sdk/mcp";

mock.module("server-only", () => ({}));

const {
  boundConnectorResult,
  connectorInputSchemaForModel,
  exposedToolName,
  offloadConnectorImages,
  primeToolHeaderBindings,
} = await import("./toolset");

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

describe("offloadConnectorImages", () => {
  test("replaces stored images with their URL and names them in order", async () => {
    const stored: string[] = [];
    const result = await offloadConnectorImages(
      {
        content: [
          { type: "text", text: "before" },
          { type: "image", mimeType: "image/jpeg", data: "AAAA" },
          { type: "image", mimeType: "image/png", data: "BBBB" },
        ],
      },
      async (image, name) => {
        stored.push(`${name}:${image.data}`);
        return `https://files.test/${name}`;
      },
      "browser-shot",
    );
    expect(stored).toEqual([
      "browser-shot-0.jpg:AAAA",
      "browser-shot-1.png:BBBB",
    ]);
    expect(result.content).toEqual([
      { type: "text", text: "before" },
      {
        type: "image",
        mimeType: "image/jpeg",
        url: "https://files.test/browser-shot-0.jpg",
      },
      {
        type: "image",
        mimeType: "image/png",
        url: "https://files.test/browser-shot-1.png",
      },
    ]);
  });

  test("keeps the bytes inline when the store declines", async () => {
    const result = await offloadConnectorImages(
      {
        content: [{ type: "image", mimeType: "image/webp", data: "CCCC" }],
        truncated: true,
      },
      async () => null,
      "shot",
    );
    expect(result).toEqual({
      content: [{ type: "image", mimeType: "image/webp", data: "CCCC" }],
      truncated: true,
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

describe("primeToolHeaderBindings", () => {
  test("hands cached definitions to the client with their header annotations intact", () => {
    const toolsFromDefinitions = mock((_definitions: ListToolsResult) => ({}));
    primeToolHeaderBindings({ toolsFromDefinitions }, [
      {
        name: "list_branches",
        description: "Branches of a repository",
        inputSchema: {
          type: "object",
          properties: {
            owner: { type: "string", "x-mcp-header": "owner" },
            repo: { type: "string", "x-mcp-header": "repo" },
            page: { type: "integer" },
          },
          required: ["owner", "repo"],
        },
      },
    ]);
    expect(toolsFromDefinitions).toHaveBeenCalledTimes(1);
    const [listed] = toolsFromDefinitions.mock.calls[0] ?? [];
    expect(listed?.tools.map((tool) => tool.name)).toEqual(["list_branches"]);
    expect(listed?.tools[0]?.inputSchema.properties).toMatchObject({
      owner: { "x-mcp-header": "owner" },
      repo: { "x-mcp-header": "repo" },
    });
  });
});
