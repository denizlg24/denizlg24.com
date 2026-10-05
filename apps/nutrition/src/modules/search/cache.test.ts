import { describe, expect, it } from "bun:test";

import { SearchCache, type SearchCacheStore } from "./cache";

const memoryStore = () => {
  const values = new Map<string, string>();
  const store: SearchCacheStore = {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => {
      values.set(key, value);
      return "OK";
    },
    incr: async (key) => {
      const next = Number(values.get(key) ?? "0") + 1;
      values.set(key, String(next));
      return next;
    },
  };
  return store;
};

describe("SearchCache", () => {
  it("answers a repeated search from the cache", async () => {
    const cache = new SearchCache(memoryStore());
    let loads = 0;
    const load = async () => {
      loads += 1;
      return [{ id: "a" }];
    };

    await cache.read({ q: "egg" }, load);
    await expect(cache.read({ q: "egg" }, load)).resolves.toEqual([
      { id: "a" },
    ]);
    expect(loads).toBe(1);
  });

  it("drops every cached answer when the index changes", async () => {
    const cache = new SearchCache(memoryStore());
    let loads = 0;
    const load = async () => {
      loads += 1;
      return loads;
    };

    await cache.read({ q: "egg" }, load);
    await cache.invalidate();
    await expect(cache.read({ q: "egg" }, load)).resolves.toBe(2);
  });

  it("searches uncached when Redis is down", async () => {
    const failing: SearchCacheStore = {
      get: () => Promise.reject(new Error("down")),
      set: () => Promise.reject(new Error("down")),
      incr: () => Promise.reject(new Error("down")),
    };
    const cache = new SearchCache(failing);

    await expect(cache.read({ q: "egg" }, async () => "fresh")).resolves.toBe(
      "fresh",
    );
    await expect(cache.invalidate()).resolves.toBe(false);
  });
});
