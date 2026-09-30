import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

const backups = new Map<string, Record<string, unknown>>();
const runs = new Map<string, Record<string, unknown>>();
let queued: Record<string, unknown> | null = null;
const revalidateTag = mock(() => {});
const collections = mock(async () => ({
  backups: {
    findOne: async ({ _id }: { _id: string }) => backups.get(_id) ?? null,
    replaceOne: async (
      filter: { _id: string; reportedAt?: string; runId?: string },
      replacement: Record<string, unknown>,
    ) => {
      const previous = backups.get(filter._id);
      if (
        previous &&
        (previous.reportedAt !== filter.reportedAt ||
          previous.runId !== filter.runId)
      )
        return { matchedCount: 0 };
      backups.set(filter._id, replacement);
      return { matchedCount: previous ? 1 : 0 };
    },
  },
  backupRuns: {
    updateOne: async (
      { _id }: { _id: string },
      { $set }: { $set: Record<string, unknown> },
    ) => {
      runs.set(_id, $set);
    },
  },
  commands: {
    updateMany: async () => ({}),
    updateOne: async () => ({ matchedCount: 1 }),
    findOneAndUpdate: async () => {
      const command = queued;
      queued = null;
      return command;
    },
  },
}));

// Bun's module mocks are process-wide and outlive this file, so each one keeps
// the real module's other exports and is put back once the suite is done.
const realCache = { ...(await import("next/cache")) };
const realDb = { ...(await import("@/lib/db")) };
mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({ ...realCache, revalidateTag }));
mock.module("@/lib/db", () => ({ ...realDb, collections }));
afterAll(() => {
  mock.module("next/cache", () => realCache);
  mock.module("@/lib/db", () => realDb);
});

const { POST } = await import("../app/api/agent/[profile]/route");
const token = "test-token-".repeat(4);
const startedAt = new Date(Date.now() - 120_000).toISOString();
const completedAt = new Date(Date.now() - 60_000).toISOString();
const report = (job: "backup" | "r2-sync") => ({
  job,
  runId: `${job}:${startedAt}`,
  status: "completed",
  startedAt,
  completedAt,
  lastSuccessAt: completedAt,
  nextRunAt: null,
  durationMs: 60_000,
  sizeBytes: null,
  enabled: true,
  schedule: null,
  detail: null,
  verification: null,
});
const request = (body: unknown) =>
  new Request("https://status.example.test/api/agent/pi", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
const context = { params: Promise.resolve({ profile: "pi" }) };

describe("agent sync route", () => {
  beforeEach(() => {
    process.env.STATUS_AGENT_PI_TOKEN = token;
    backups.clear();
    runs.clear();
    queued = null;
    collections.mockClear();
    revalidateTag.mockClear();
  });

  test("stores a host's reports and claims a command in one request", async () => {
    queued = {
      _id: "d404f213-01af-4255-805c-2b513b13ea76",
      job: "backup",
      action: "run",
      schedule: null,
      enabled: null,
    };
    const response = await POST(
      request({ type: "sync", reports: [report("backup"), report("r2-sync")] }),
      context,
    );
    expect(response.status).toBe(200);
    expect((await response.json()).command?.job).toBe("backup");
    expect(backups.size).toBe(2);
    expect(runs.size).toBe(2);
    expect(revalidateTag).toHaveBeenCalledTimes(1);
  });

  test("keeps legacy report and claim requests working", async () => {
    const saved = await POST(
      request({ type: "report", report: report("backup") }),
      context,
    );
    expect(await saved.json()).toEqual({ accepted: true });
    const claimed = await POST(request({ type: "claim" }), context);
    expect(await claimed.json()).toEqual({ command: null });
    expect(revalidateTag).toHaveBeenCalledTimes(1);
  });

  test("rejects duplicate jobs before writing anything", async () => {
    const response = await POST(
      request({ type: "sync", reports: [report("backup"), report("backup")] }),
      context,
    );
    expect(response.status).toBe(400);
    expect(collections).not.toHaveBeenCalled();
  });
});
