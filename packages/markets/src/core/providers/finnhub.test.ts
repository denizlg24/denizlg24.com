import { describe, expect, test } from "bun:test";
import { createMemoryStores } from "../memory-stores";
import { BudgetExhaustedError } from "../ports";
import { FinnhubProvider } from "./finnhub";

function provider(
  handler: (url: URL) => unknown,
  dailyLimit?: number,
  status = 200,
) {
  const stores = createMemoryStores(
    dailyLimit === undefined ? undefined : { dayLimit: dailyLimit },
  );
  const calls: URL[] = [];
  const instance = new FinnhubProvider({
    apiKey: "test-key",
    budget: stores.budget,
    fetchImpl: (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      calls.push(url);
      return new Response(JSON.stringify(handler(url)), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch,
  });
  return { instance, calls, stores };
}

describe("FinnhubProvider profiles", () => {
  test("scales the millions the API reports into absolute figures", async () => {
    const { instance } = provider(() => ({
      ticker: "aapl",
      name: "Apple Inc",
      country: "US",
      finnhubIndustry: "Technology",
      ipo: "1980-12-12",
      logo: "https://static.finnhub.io/aapl.png",
      weburl: "https://www.apple.com/",
      marketCapitalization: 3_000_000,
      shareOutstanding: 15_000,
    }));

    const profile = await instance.getProfile("aapl");

    expect(profile?.ticker).toBe("AAPL");
    expect(profile?.marketCap).toBe(3e12);
    expect(profile?.sharesOutstanding).toBe(1.5e10);
    expect(profile?.ipoDate).toBe("1980-12-12");
  });

  test("an unknown symbol answers 200 with an empty body, not a 404", async () => {
    const { instance } = provider(() => ({}));
    expect(await instance.getProfile("NOPE")).toBeNull();
  });

  test("drops fields whose URL the schemas would reject", async () => {
    const { instance } = provider(() => ({
      ticker: "XYZ",
      name: "Example",
      logo: "",
      weburl: "not a url",
    }));

    const profile = await instance.getProfile("XYZ");
    expect(profile?.logoUrl).toBeUndefined();
    expect(profile?.website).toBeUndefined();
  });

  test("the key travels in a header, never the query string", async () => {
    const { instance, calls } = provider(() => ({ ticker: "A", name: "A" }));
    await instance.getProfile("A");
    expect(calls[0]?.searchParams.get("token")).toBeNull();
    expect(calls[0]?.toString()).not.toContain("test-key");
  });
});

describe("FinnhubProvider news", () => {
  const story = {
    id: 12345,
    datetime: 1_753_000_000,
    headline: "Something happened",
    summary: "A summary",
    source: "Reuters",
    url: "https://example.com/story",
    image: "https://example.com/story.jpg",
  };

  test("keys ids by ticker so syndicated stories cannot collide", async () => {
    const { instance } = provider(() => [story]);
    const [first] = await instance.getNews("AAPL", 10);
    expect(first?.id).toBe("AAPL:12345");
    expect(first?.publishedAt).toBe(new Date(1_753_000_000_000).toISOString());
  });

  test("skips stories with no headline or an unusable link", async () => {
    const { instance } = provider(() => [
      story,
      { ...story, id: 2, headline: null },
      { ...story, id: 3, url: "javascript:alert(1)" },
    ]);
    const news = await instance.getNews("AAPL", 10);
    expect(news).toHaveLength(1);
  });

  test("honours the limit", async () => {
    const { instance } = provider(() =>
      Array.from({ length: 40 }, (_, i) => ({ ...story, id: i })),
    );
    expect(await instance.getNews("AAPL", 5)).toHaveLength(5);
  });
});

describe("FinnhubProvider search", () => {
  test("ranks by the order the API returned and prefers the display symbol", async () => {
    const { instance } = provider(() => ({
      result: [
        {
          description: "Apple Inc",
          displaySymbol: "AAPL",
          symbol: "AAPL",
          type: "Common Stock",
        },
        {
          description: "Apple ETF",
          displaySymbol: "AAPU",
          symbol: "AAPU",
          type: "ETP",
        },
      ],
    }));

    const results = await instance.searchSymbols("apple", 10);
    expect(results.map((item) => item.ticker)).toEqual(["AAPL", "AAPU"]);
    expect(results[0]?.assetType).toBe("stock");
    expect(results[1]?.assetType).toBe("etf");
    expect(results[0]?.score).toBeGreaterThan(results[1]?.score ?? 0);
  });
});

describe("FinnhubProvider budget", () => {
  test("refuses to call once the ledger is spent", async () => {
    const { instance, calls } = provider(() => ({ ticker: "A", name: "A" }), 1);
    await instance.getProfile("A");
    await expect(instance.getProfile("A")).rejects.toBeInstanceOf(
      BudgetExhaustedError,
    );
    expect(calls).toHaveLength(1);
  });

  // A request that reached Finnhub counted against the account whatever it
  // answered, so the local ledger keeps it. Only a send that never left is
  // handed back.
  test("a rate-limited request still spends its reservation", async () => {
    const { instance, stores } = provider(() => ({}), undefined, 429);
    await expect(instance.getProfile("A")).rejects.toThrow("Rate limited");
    expect((await stores.budget.peek("finnhub")).hourUsed).toBe(1);
  });

  test("a server error still spends its reservation", async () => {
    const { instance, stores } = provider(() => ({}), undefined, 500);
    await expect(instance.getProfile("A")).rejects.toThrow("500");
    expect((await stores.budget.peek("finnhub")).hourUsed).toBe(1);
  });

  test("a send that never left hands its reservation back", async () => {
    const stores = createMemoryStores();
    const instance = new FinnhubProvider({
      apiKey: "test-key",
      budget: stores.budget,
      fetchImpl: (async () => {
        throw new Error("ECONNRESET");
      }) as unknown as typeof fetch,
    });
    await expect(instance.getProfile("A")).rejects.toThrow("Request failed");
    expect((await stores.budget.peek("finnhub")).hourUsed).toBe(0);
  });
});
