import { describe, expect, test } from "bun:test";
import { createMemoryStores } from "../memory-stores";
import { ProviderError } from "../ports";
import { EdgarProvider } from "./edgar";

function provider(status: number, body: unknown = {}) {
  const stores = createMemoryStores();
  const calls: URL[] = [];
  const instance = new EdgarProvider({
    userAgent: "test test@example.com",
    budget: stores.budget,
    fetchImpl: (async (input: RequestInfo | URL) => {
      calls.push(new URL(String(input)));
      return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch,
  });
  return { instance, calls };
}

describe("EdgarProvider getFundamentals", () => {
  // SPY has a CIK in company_tickers.json but tags no XBRL facts, so the cron
  // logged a hard error for it on every run it came round in the rotation.
  test("a filer with no XBRL facts reads as no periods, not an error", async () => {
    const { instance } = provider(404);
    expect(await instance.getFundamentals("0000884394", "SPY")).toEqual([]);
  });

  test("other failures still surface", async () => {
    const { instance } = provider(500);
    await expect(
      instance.getFundamentals("0000320193", "AAPL"),
    ).rejects.toBeInstanceOf(ProviderError);
  });
});
