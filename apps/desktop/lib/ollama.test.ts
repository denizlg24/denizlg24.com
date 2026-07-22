import { describe, expect, it } from "bun:test";
import { OllamaClient } from "./ollama";

describe("OllamaClient", () => {
  it("only accepts loopback endpoints", () => {
    expect(
      () => new OllamaClient({ baseUrl: "https://example.com" }),
    ).toThrow();
    expect(
      () => new OllamaClient({ baseUrl: "http://192.168.1.2:11434" }),
    ).toThrow();
  });

  it("discovers models and keeps embedding profiles isolated", async () => {
    const client = new OllamaClient({
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith("/api/tags")) {
          return Response.json({ models: [{ name: "embed", model: "embed" }] });
        }
        return Response.json({ embeddings: [[1, 2, 3]] });
      },
    });
    expect(await client.listModels()).toHaveLength(1);
    const embedded = await client.embed({ model: "embed", input: ["text"] });
    expect(embedded.profile).toEqual({
      provider: "ollama",
      model: "embed",
      dimensions: 3,
    });
  });
});
