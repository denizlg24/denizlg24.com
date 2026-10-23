import { afterEach, describe, expect, test } from "bun:test";
import {
  MACROS_CACHE_VERSIONS,
  type MacrosCacheVersions,
} from "@repo/schemas/macros";
import {
  dehydrate,
  onlineManager,
  QueryClient,
  QueryObserver,
} from "@tanstack/react-query";
import {
  type PersistedClient,
  persistQueryClientRestore,
} from "@tanstack/react-query-persist-client";
import {
  APPLIED_CACHE_VERSIONS_KEY,
  migratePersistedCache,
  PERSIST_BUSTER,
  revalidateFoodCaches,
} from "./food-cache";

const clients: QueryClient[] = [];
const previous: MacrosCacheVersions = {
  foods: "foods-old",
  foodIcons: "art-old",
};

function client() {
  const value = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity } },
  });
  clients.push(value);
  value.setQueryData(APPLIED_CACHE_VERSIONS_KEY, previous);
  for (const domain of [
    "foods",
    "food-log",
    "pantry",
    "dashboard",
    "recipes",
    "meal-templates",
    "shopping-list",
    "food-icons",
    "profile",
    "weight",
  ])
    value.setQueryData([domain], { cached: domain });
  return value;
}

afterEach(() => {
  onlineManager.setOnline(true);
  for (const value of clients.splice(0)) value.clear();
});

describe("food cache revisions", () => {
  test("unchanged policy leaves fresh caches alone", async () => {
    const value = client();
    await revalidateFoodCaches(value, previous);
    expect(
      value
        .getQueryCache()
        .getAll()
        .every((q) => !q.state.isInvalidated),
    ).toBe(true);
  });

  test("food changes invalidate all food-containing reads but retain offline data", async () => {
    onlineManager.setOnline(false);
    const value = client();
    await revalidateFoodCaches(value, { ...previous, foods: "foods-new" });
    for (const domain of [
      "foods",
      "food-log",
      "pantry",
      "dashboard",
      "recipes",
      "meal-templates",
      "shopping-list",
    ]) {
      expect(value.getQueryState([domain])?.isInvalidated).toBe(true);
      expect(value.getQueryData<{ cached: string }>([domain])).toEqual({
        cached: domain,
      });
    }
    for (const domain of ["profile", "weight", "food-icons"]) {
      expect(value.getQueryState([domain])?.isInvalidated).toBe(false);
    }
  });

  test("an artwork-only bump and rollback invalidate only the icon catalogue", async () => {
    const value = client();
    await revalidateFoodCaches(value, { ...previous, foodIcons: "art-new" });
    expect(value.getQueryState(["food-icons"])?.isInvalidated).toBe(true);
    expect(value.getQueryState(["foods"])?.isInvalidated).toBe(false);
    value.setQueryData(["food-icons"], { refreshed: true });
    await revalidateFoodCaches(value, previous);
    expect(value.getQueryState(["food-icons"])?.isInvalidated).toBe(true);
  });

  test("first use refreshes legacy caches without removing unrelated data", async () => {
    const value = client();
    value.removeQueries({ queryKey: APPLIED_CACHE_VERSIONS_KEY });
    await revalidateFoodCaches(value, MACROS_CACHE_VERSIONS);
    expect(value.getQueryState(["foods"])?.isInvalidated).toBe(true);
    expect(value.getQueryState(["food-icons"])?.isInvalidated).toBe(true);
    expect(value.getQueryData<{ cached: string }>(["profile"])).toEqual({
      cached: "profile",
    });
  });

  test("a changed revision refetches an active read, and the same revision does not repeat it", async () => {
    const value = client();
    let fetches = 0;
    const observer = new QueryObserver(value, {
      queryKey: ["foods"],
      queryFn: async () => ({ cached: `fresh-${++fetches}` }),
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});
    try {
      const next = { ...previous, foods: "foods-new" };
      await revalidateFoodCaches(value, next);
      expect(value.getQueryData<{ cached: string }>(["foods"])).toEqual({
        cached: "fresh-1",
      });
      await revalidateFoodCaches(value, next);
      expect(fetches).toBe(1);
    } finally {
      unsubscribe();
      observer.destroy();
    }
  });

  test("a release upgrade and revision retain paused writes and resume their exact IDs", async () => {
    const before = client();
    const variables = { clientMutationId: "offline-log-123", amount: 2 };
    before.getMutationCache().build(
      before,
      { mutationKey: ["food-log", "create"] },
      {
        context: undefined,
        data: undefined,
        error: null,
        failureCount: 0,
        failureReason: null,
        isPaused: true,
        status: "pending",
        variables,
        submittedAt: Date.now(),
      },
    );
    const persisted: PersistedClient = {
      buster: "0.0.20:1",
      timestamp: Date.now(),
      clientState: dehydrate(before),
    };
    const after = client();
    let resumed: unknown;
    after.setMutationDefaults(["food-log", "create"], {
      mutationFn: async (body) => {
        resumed = body;
      },
    });
    await persistQueryClientRestore({
      queryClient: after,
      buster: PERSIST_BUSTER,
      persister: {
        restoreClient: async () => migratePersistedCache(persisted),
        persistClient: async () => {},
        removeClient: async () => {
          throw new Error("Must not discard offline work");
        },
      },
    });
    await revalidateFoodCaches(after, MACROS_CACHE_VERSIONS);
    expect(after.getMutationCache().getAll()).toHaveLength(1);
    expect(after.getMutationCache().getAll()[0]?.state.variables).toEqual(
      variables,
    );
    await after.resumePausedMutations();
    expect(resumed).toEqual(variables);
  });

  test("unknown persistence formats are not silently accepted", () => {
    const persisted: PersistedClient = {
      buster: "future-incompatible-format",
      timestamp: Date.now(),
      clientState: dehydrate(client()),
    };
    expect(migratePersistedCache(persisted)).toBe(persisted);
  });
});
