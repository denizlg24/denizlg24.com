import {
  afterAll,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  test,
} from "bun:test";
import { CatalogUnavailableError } from "./llm-errors";
import {
  __resetCatalogForTests,
  findModel,
  getCatalog,
  listModels,
} from "./llm-model-catalog";

// Catalog behavior: validation, filtering, 15-minute caching, refresh
// deduplication, retry, stale-on-error, and typed cold failure. All fetches
// are intercepted; no request must reach the network.

interface UpstreamModel {
  id: string;
  name: string;
  owned_by: string;
  type: string;
  tags?: string[];
  context_window?: number;
  max_tokens?: number;
  pricing?: Record<string, unknown>;
  description?: string;
}

function upstream(models: unknown[]): Response {
  return new Response(JSON.stringify({ object: "list", data: models }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const validModels: UpstreamModel[] = [
  {
    id: "anthropic/claude-haiku-4.5",
    name: "Claude Haiku 4.5",
    owned_by: "anthropic",
    type: "language",
    tags: ["tool-use", "web-search", "reasoning", "explicit-caching"],
    context_window: 200000,
    max_tokens: 64000,
    pricing: {
      input: "0.000001",
      output: "0.000005",
      input_cache_read: "0.0000001",
      input_cache_write: "0.00000125",
    },
  },
  {
    id: "anthropic/claude-opus-4.7",
    name: "Claude Opus 4.7",
    owned_by: "anthropic",
    type: "language",
    tags: ["tool-use", "web-search", "reasoning"],
    context_window: 1000000,
    max_tokens: 128000,
    pricing: { input: "0.000005", output: "0.000025" },
  },
  {
    id: "deepseek/deepseek-v3.2",
    name: "DeepSeek V3.2",
    owned_by: "deepseek",
    type: "language",
    tags: ["tool-use"],
    context_window: 128000,
    max_tokens: 8192,
    pricing: {
      input: "0.00000027",
      output: "0.0000011",
      input_tiers: [{ up_to: 1000000, price: "0.0000002" }],
    },
  },
  {
    id: "openai/gpt-image-1",
    name: "GPT Image 1",
    owned_by: "openai",
    type: "image",
    tags: ["image-generation"],
    pricing: { image: "0.01" },
  },
];

let fetchCalls: { url: string; init?: RequestInit }[] = [];
let respond: () => Response | Promise<Response>;

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.includes("ai-gateway.vercel.sh/v1/models")) {
    throw new Error(`Unexpected fetch in catalog tests: ${url}`);
  }
  fetchCalls.push({ url, init });
  return respond();
}) as typeof fetch;

afterAll(() => {
  globalThis.fetch = realFetch;
  setSystemTime();
});

beforeEach(() => {
  __resetCatalogForTests();
  setSystemTime();
  fetchCalls = [];
  respond = () => upstream(validModels);
});

describe("getCatalog", () => {
  test("fetches, validates, and returns models with fetchedAt", async () => {
    const result = await getCatalog();
    expect(result.stale).toBe(false);
    expect(result.models.map((m) => m.id)).toContain(
      "anthropic/claude-haiku-4.5",
    );
    expect(fetchCalls).toHaveLength(1);
    // Discovery is unauthenticated.
    const headers = (fetchCalls[0]?.init?.headers ?? {}) as Record<
      string,
      string
    >;
    expect(Object.keys(headers).join(",").toLowerCase()).not.toContain(
      "authorization",
    );
  });

  test("parses pricing into per-token numbers and flags tiers", async () => {
    await getCatalog();
    const haiku = await findModel("anthropic/claude-haiku-4.5");
    expect(haiku?.pricing).toEqual({
      input: 0.000001,
      output: 0.000005,
      cacheRead: 0.0000001,
      cacheWrite: 0.00000125,
      hasTiers: false,
    });
    const deepseek = await findModel("deepseek/deepseek-v3.2");
    expect(deepseek?.pricing?.hasTiers).toBe(true);
  });

  test("serves the cache within the 15-minute TTL and refreshes after", async () => {
    setSystemTime(new Date("2026-07-13T10:00:00Z"));
    await getCatalog();
    setSystemTime(new Date("2026-07-13T10:14:00Z"));
    await getCatalog();
    expect(fetchCalls).toHaveLength(1);

    setSystemTime(new Date("2026-07-13T10:16:00Z"));
    await getCatalog();
    expect(fetchCalls).toHaveLength(2);
  });

  test("deduplicates concurrent refreshes into one upstream request", async () => {
    let release: ((response: Response) => void) | undefined;
    respond = () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      });

    const first = getCatalog();
    const second = getCatalog();
    await Promise.resolve();
    release?.(upstream(validModels));
    const [a, b] = await Promise.all([first, second]);
    expect(fetchCalls).toHaveLength(1);
    expect(a.models).toEqual(b.models);
  });

  test("retries once and succeeds on the second attempt", async () => {
    let attempt = 0;
    respond = () => {
      attempt += 1;
      if (attempt === 1) throw new Error("network down");
      return upstream(validModels);
    };
    const result = await getCatalog();
    expect(result.stale).toBe(false);
    expect(fetchCalls).toHaveLength(2);
  });

  test("serves stale data when a refresh fails after expiry", async () => {
    setSystemTime(new Date("2026-07-13T10:00:00Z"));
    await getCatalog();

    setSystemTime(new Date("2026-07-13T10:30:00Z"));
    respond = () => {
      throw new Error("gateway down");
    };
    const result = await getCatalog();
    expect(result.stale).toBe(true);
    expect(result.models.length).toBeGreaterThan(0);
    expect(result.fetchedAt).toEqual(new Date("2026-07-13T10:00:00Z"));
  });

  test("throws a typed error on a cold start with no stale copy", async () => {
    respond = () => {
      throw new Error("gateway down");
    };
    expect(getCatalog()).rejects.toBeInstanceOf(CatalogUnavailableError);
  });

  test("does not cache a non-2xx response as success", async () => {
    respond = () => new Response("oops", { status: 502 });
    await expect(getCatalog()).rejects.toBeInstanceOf(CatalogUnavailableError);

    respond = () => upstream(validModels);
    const result = await getCatalog();
    expect(result.stale).toBe(false);
  });

  test("rejects a malformed body instead of caching it", async () => {
    respond = () =>
      new Response(JSON.stringify({ unexpected: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    expect(getCatalog()).rejects.toBeInstanceOf(CatalogUnavailableError);
  });

  test("drops individually malformed entries but keeps the rest", async () => {
    respond = () => upstream([...validModels, { id: 42, bogus: true }]);
    const result = await getCatalog();
    expect(result.models).toHaveLength(validModels.length);
  });
});

describe("listModels", () => {
  test("returns only language models sorted by creator then name", async () => {
    const { models } = await listModels();
    expect(models.map((m) => m.id)).toEqual([
      "anthropic/claude-haiku-4.5",
      "anthropic/claude-opus-4.7",
      "deepseek/deepseek-v3.2",
    ]);
  });

  test("filters by creator", async () => {
    const { models } = await listModels({ creator: "deepseek" });
    expect(models.map((m) => m.id)).toEqual(["deepseek/deepseek-v3.2"]);
  });

  test("requires all requested tags", async () => {
    const { models } = await listModels({
      requiredTags: ["tool-use", "web-search"],
    });
    expect(models.map((m) => m.id)).toEqual([
      "anthropic/claude-haiku-4.5",
      "anthropic/claude-opus-4.7",
    ]);
  });
});

describe("findModel", () => {
  test("returns null for a model that left the catalog", async () => {
    setSystemTime(new Date("2026-07-13T10:00:00Z"));
    await getCatalog();
    expect(await findModel("anthropic/claude-opus-4.7")).not.toBeNull();

    setSystemTime(new Date("2026-07-13T10:20:00Z"));
    respond = () =>
      upstream(validModels.filter((m) => m.id !== "anthropic/claude-opus-4.7"));
    expect(await findModel("anthropic/claude-opus-4.7")).toBeNull();
  });
});
