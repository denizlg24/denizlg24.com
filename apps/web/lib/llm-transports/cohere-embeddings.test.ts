import { afterEach, describe, expect, test } from "bun:test";
import { requestMultimodalEmbedding } from "./cohere-embeddings";

const originalFetch = globalThis.fetch;
const originalKey = process.env.COHERE_API_KEY;

function stubFetch(handler: (body: Record<string, unknown>) => Response) {
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    return handler(JSON.parse(String(init?.body ?? "{}")));
  }) as typeof fetch;
}

function vectorResponse(count: number, dimensions: number) {
  return new Response(
    JSON.stringify({
      embeddings: {
        float: Array.from({ length: count }, () => Array(dimensions).fill(0.1)),
      },
      meta: { billed_units: { input_tokens: 7, image_tokens: 66 } },
    }),
    { status: 200 },
  );
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.COHERE_API_KEY;
  else process.env.COHERE_API_KEY = originalKey;
});

describe("requestMultimodalEmbedding", () => {
  test("strips the namespace prefix before calling Cohere", async () => {
    process.env.COHERE_API_KEY = "test-key";
    let seen: Record<string, unknown> = {};
    stubFetch((body) => {
      seen = body;
      return vectorResponse(1, 4);
    });

    await requestMultimodalEmbedding({
      model: "cohere/embed-v4.0",
      inputs: [{ text: "hello" }],
      dimensions: 4,
      inputType: "search_query",
    });

    expect(seen.model).toBe("embed-v4.0");
    expect(seen.input_type).toBe("search_query");
    expect(seen.output_dimension).toBe(4);
  });

  test("sends text and image as one content array", async () => {
    process.env.COHERE_API_KEY = "test-key";
    let seen: Record<string, unknown> = {};
    stubFetch((body) => {
      seen = body;
      return vectorResponse(1, 4);
    });

    await requestMultimodalEmbedding({
      model: "cohere/embed-v4.0",
      inputs: [{ text: "a chart", image: "data:image/png;base64,AAAA" }],
      dimensions: 4,
      inputType: "search_document",
    });

    const inputs = seen.inputs as Array<{ content: Array<{ type: string }> }>;
    expect(inputs[0]?.content.map((part) => part.type)).toEqual([
      "text",
      "image",
    ]);
  });

  test("reports both token meters", async () => {
    process.env.COHERE_API_KEY = "test-key";
    stubFetch(() => vectorResponse(1, 4));

    const result = await requestMultimodalEmbedding({
      model: "cohere/embed-v4.0",
      inputs: [{ image: "data:image/png;base64,AAAA" }],
      dimensions: 4,
      inputType: "search_document",
    });

    expect(result.inputTokens).toBe(7);
    expect(result.imageTokens).toBe(66);
    expect(result.vectors).toHaveLength(1);
  });

  test("rejects an input carrying neither text nor image", async () => {
    process.env.COHERE_API_KEY = "test-key";
    stubFetch(() => vectorResponse(1, 4));

    await expect(
      requestMultimodalEmbedding({
        model: "cohere/embed-v4.0",
        inputs: [{ text: "   " }],
        dimensions: 4,
        inputType: "search_document",
      }),
    ).rejects.toThrow(/needs text, an image, or both/);
  });

  test("rejects a response whose dimensions do not match the index", async () => {
    process.env.COHERE_API_KEY = "test-key";
    stubFetch(() => vectorResponse(1, 3));

    await expect(
      requestMultimodalEmbedding({
        model: "cohere/embed-v4.0",
        inputs: [{ text: "hello" }],
        dimensions: 4,
        inputType: "search_document",
      }),
    ).rejects.toThrow(/finite dimensions/);
  });

  test("rejects a response with the wrong number of vectors", async () => {
    process.env.COHERE_API_KEY = "test-key";
    stubFetch(() => vectorResponse(1, 4));

    await expect(
      requestMultimodalEmbedding({
        model: "cohere/embed-v4.0",
        inputs: [{ text: "one" }, { text: "two" }],
        dimensions: 4,
        inputType: "search_document",
      }),
    ).rejects.toThrow(/did not contain 2 vectors/);
  });

  test("fails clearly when the credential is missing", async () => {
    delete process.env.COHERE_API_KEY;
    await expect(
      requestMultimodalEmbedding({
        model: "cohere/embed-v4.0",
        inputs: [{ text: "hello" }],
        dimensions: 4,
        inputType: "search_document",
      }),
    ).rejects.toThrow(/COHERE_API_KEY is not configured/);
  });
});
