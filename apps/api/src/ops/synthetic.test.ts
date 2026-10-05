import { describe, expect, it } from "bun:test";

import {
  DeepSyntheticService,
  type SearchProbeClient,
  SYNTHETIC_DEPENDENCIES,
  searchSyntheticProbe,
} from "./synthetic";

describe("DeepSyntheticService", () => {
  it("crosses every required dependency", async () => {
    const called: string[] = [];
    const service = new DeepSyntheticService(
      Object.fromEntries(
        SYNTHETIC_DEPENDENCIES.map((name) => [
          name,
          async () => {
            called.push(name);
          },
        ]),
      ) as unknown as ConstructorParameters<typeof DeepSyntheticService>[0],
    );

    const result = await service.check();

    expect(result.status).toBe("ok");
    expect(called.sort()).toEqual([...SYNTHETIC_DEPENDENCIES].sort());
  });

  it("fails the aggregate without skipping neighbouring probes", async () => {
    const called: string[] = [];
    const service = new DeepSyntheticService(
      Object.fromEntries(
        SYNTHETIC_DEPENDENCIES.map((name) => [
          name,
          async () => {
            called.push(name);
            if (name === "redis") throw new Error("write refused");
          },
        ]),
      ) as unknown as ConstructorParameters<typeof DeepSyntheticService>[0],
    );

    const result = await service.check();

    expect(result.status).toBe("down");
    expect(result.checks.redis.error).toBe("write refused");
    expect(called).toHaveLength(SYNTHETIC_DEPENDENCIES.length);
  });
});

/**
 * A Meilisearch stand-in whose canary task resolves after `resolveAfterPolls`
 * polls — or never, when that is null.
 */
function searchClient(options: {
  resolveAfterPolls: number | null;
  taskStatus?: string;
  taskError?: { message?: string } | null;
  document?: { id: string; value: string } | undefined;
}) {
  const calls = {
    added: [] as string[],
    deleted: [] as string[],
    searched: 0,
    polls: 0,
    waited: [] as number[],
  };
  const client: SearchProbeClient = {
    index: () => ({
      addDocuments: async (documents) => {
        calls.added.push(...documents.map((document) => document.id));
        return { taskUid: 41 };
      },
      getDocument: async () =>
        options.document === undefined
          ? { value: calls.added[0] }
          : options.document,
      deleteDocument: async (id) => {
        calls.deleted.push(String(id));
      },
      search: async () => {
        calls.searched += 1;
        return {};
      },
    }),
    tasks: {
      getTask: async (uid) => {
        calls.polls += 1;
        calls.waited.push(uid);
        if (
          options.resolveAfterPolls === null ||
          calls.polls <= options.resolveAfterPolls
        )
          return { status: "enqueued" };
        return {
          status: options.taskStatus ?? "succeeded",
          error: options.taskError ?? null,
        };
      },
    },
  };
  return { client, calls };
}

describe("searchSyntheticProbe", () => {
  it("passes once the canary task succeeds and reads back", async () => {
    const { client, calls } = searchClient({ resolveAfterPolls: 1 });

    expect(await searchSyntheticProbe(client, 50)("canary")).toBeUndefined();
    expect(calls.added).toEqual(["canary"]);
    expect(calls.deleted).toEqual(["canary"]);
  });

  it("degrades rather than failing while the task queue is backed up", async () => {
    const { client, calls } = searchClient({ resolveAfterPolls: null });

    const outcome = await searchSyntheticProbe(client, 50)("canary");

    expect(outcome?.status).toBe("degraded");
    expect(outcome?.message).toContain("still queued");
    // The read path is what consumers depend on, so a degradation is only
    // reported once a query has been answered.
    expect(calls.searched).toBe(1);
    expect(calls.deleted).toEqual(["canary"]);
  });

  it("fails when the engine cannot serve reads either", async () => {
    const { client } = searchClient({ resolveAfterPolls: null });
    const index = client.index("deniz_dr_synthetic");
    client.index = () => ({
      ...index,
      search: async () => {
        throw new Error("connection refused");
      },
    });

    expect(searchSyntheticProbe(client, 50)("canary")).rejects.toThrow(
      "connection refused",
    );
  });

  it("fails when the canary task itself failed", async () => {
    const { client } = searchClient({
      resolveAfterPolls: 1,
      taskStatus: "failed",
      taskError: { message: "index primary key mismatch" },
    });

    expect(searchSyntheticProbe(client, 50)("canary")).rejects.toThrow(
      "index primary key mismatch",
    );
  });

  it("fails when the document does not read back", async () => {
    const { client } = searchClient({
      resolveAfterPolls: 1,
      document: { id: "canary", value: "something else" },
    });

    expect(searchSyntheticProbe(client, 50)("canary")).rejects.toThrow(
      "canary read did not match its write",
    );
  });

  it("treats a bodyless poll as pending instead of crashing on it", async () => {
    // The client's own waitTask() dereferences `.status` here and throws
    // "undefined is not an object", which is how a transport hiccup used to
    // surface as a hard search outage.
    let polls = 0;
    const client: SearchProbeClient = {
      index: () => ({
        addDocuments: async () => ({ taskUid: 7 }),
        getDocument: async () => ({ id: "canary", value: "canary" }),
        deleteDocument: async () => undefined,
        search: async () => ({}),
      }),
      tasks: {
        getTask: async () => {
          polls += 1;
          return polls === 1 ? undefined : { status: "succeeded" };
        },
      },
    };

    expect(await searchSyntheticProbe(client, 50)("canary")).toBeUndefined();
    expect(polls).toBe(2);
  });
});

describe("DeepSyntheticService degradation", () => {
  it("keeps the aggregate out of down when a probe only degrades", async () => {
    const service = new DeepSyntheticService(
      Object.fromEntries(
        SYNTHETIC_DEPENDENCIES.map((name) => [
          name,
          async () =>
            name === "search"
              ? { status: "degraded" as const, message: "queue is busy" }
              : undefined,
        ]),
      ) as unknown as ConstructorParameters<typeof DeepSyntheticService>[0],
    );

    const result = await service.check();

    expect(result.status).toBe("degraded");
    expect(result.checks.search.status).toBe("degraded");
    expect(result.checks.search.message).toBe("queue is busy");
    expect(result.checks.search.error).toBeNull();
    expect(result.checks.redis.status).toBe("ok");
  });

  it("still reports down when a probe degrades beside a real failure", async () => {
    const service = new DeepSyntheticService(
      Object.fromEntries(
        SYNTHETIC_DEPENDENCIES.map((name) => [
          name,
          async () => {
            if (name === "search")
              return { status: "degraded" as const, message: "queue is busy" };
            if (name === "redis") throw new Error("write refused");
          },
        ]),
      ) as unknown as ConstructorParameters<typeof DeepSyntheticService>[0],
    );

    expect((await service.check()).status).toBe("down");
  });
});
