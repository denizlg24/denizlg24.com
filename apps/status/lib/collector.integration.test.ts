import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { appOrigins } from "./catalog";
import { collectStatus } from "./collector";
import { collections, setupDatabase } from "./db";

const enabled = process.env.RUN_STATUS_INTEGRATION_TESTS === "1";
// Use only a dedicated local disposable MongoDB; never an environment's store.
const local = process.env.STATUS_MONGODB_URI?.startsWith(
  "mongodb://127.0.0.1:27029/",
);
const suite = enabled && local ? describe : describe.skip;

suite("collector with real MongoDB and simulated upstreams", () => {
  let failBetterStack = false;
  let comments = 0;
  let fetcher: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
  const at = new Date().toISOString();
  const check = (status = "ok") => ({
    status,
    latencyMs: 4,
    error:
      status === "ok"
        ? null
        : "Database refused connection at private-host:5432",
  });
  const monitoring = {
    timestamp: at,
    health: {
      timestamp: at,
      checks: Object.fromEntries(
        [
          "postgres",
          "mongodb",
          "redis",
          "meilisearch",
          "mongot",
          "disk",
          "tunnel",
          "forge",
        ].map((id) => [id, check()]),
      ),
    },
    deep: {
      timestamp: at,
      checks: Object.fromEntries(
        [
          "postgres",
          "mongodb",
          "redis",
          "posix",
          "objectStorage",
          "storageProtocol",
          "search",
        ].map((id) => [id, check(id === "postgres" ? "down" : "ok")]),
      ),
    },
    backups: {
      tasks: [
        {
          id: "backup1",
          name: "Daily PostgreSQL",
          type: "backup_postgres",
          enabled: true,
          cronExpression: "0 3 * * *",
          nextRunAt: at,
        },
      ],
      runs: [],
      successes: [],
    },
  };
  beforeAll(async () => {
    process.env.STATUS_MONGODB_DATABASE = "deniz_status_test";
    process.env.STATUS_CLOUD_API_URL = "https://api.example.test";
    process.env.STATUS_COLLECTOR_TOKEN = "test-token-".repeat(5);
    process.env.BETTERSTACK_API_TOKEN = "test-only";
    const c = await collections();
    await Promise.all(
      Object.values(c).map((collection) => collection.deleteMany({})),
    );
    await setupDatabase();
    const preconnect = globalThis.fetch.preconnect;
    fetcher = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (input: Parameters<typeof fetch>[0]) => {
          const url = new URL(
            input instanceof Request ? input.url : String(input),
          );
          if (url.hostname === "api.example.test")
            return Response.json(monitoring);
          const app = Object.entries(appOrigins).find(
            ([, origin]) => origin === url.origin,
          );
          if (app) return Response.json({ status: "ok", service: app[0] });
          if (url.hostname !== "uptime.betterstack.com")
            throw new Error("Unexpected upstream in test");
          if (failBetterStack)
            return new Response("unavailable", { status: 503 });
          if (url.pathname.endsWith("/comments")) {
            comments++;
            return Response.json({ data: {} });
          }
          if (url.pathname.endsWith("/response-times"))
            return Response.json({
              data: {
                attributes: {
                  regions: [
                    {
                      region: "eu",
                      response_times: [
                        {
                          at,
                          response_time: 0.42,
                          name_lookup_time: 0.01,
                          connection_time: 0.1,
                          tls_handshake_time: 0.1,
                          data_transfer_time: 0.21,
                        },
                      ],
                    },
                  ],
                },
              },
            });
          if (url.pathname.endsWith("/monitors"))
            return Response.json({
              data: [
                {
                  id: "12",
                  attributes: {
                    url: "https://api.denizlg24.com/healthz/deep",
                    pronounceable_name: "Deep transactions",
                    status: "down",
                    last_checked_at: at,
                  },
                },
              ],
              pagination: { next: null },
            });
          if (url.pathname.endsWith("/heartbeats"))
            return Response.json({
              data: [
                {
                  id: "9",
                  attributes: {
                    name: "Pi heartbeat",
                    status: "up",
                    last_ping_at: at,
                  },
                },
              ],
            });
          if (url.pathname.endsWith("/incidents"))
            return Response.json({
              data: [
                {
                  id: "34",
                  attributes: {
                    name: "Deep transaction failed",
                    cause: "HTTP 503 private-host:5432",
                    started_at: at,
                    resolved_at: null,
                    acknowledged_at: null,
                  },
                  relationships: { monitor: { data: { id: "12" } } },
                },
              ],
              pagination: { next: null },
            });
          throw new Error(`Unexpected fixture path: ${url.pathname}`);
        },
        { preconnect },
      ),
    );
  });
  afterAll(() => fetcher?.mockRestore());

  test("collects real documents, correlates failures, and deduplicates retries", async () => {
    expect((await collectStatus()).skipped).toBe(false);
    const c = await collections();
    const snapshot = await c.snapshots.findOne({ _id: "latest" });
    expect(
      snapshot?.services.find((service) => service.id === "postgres")?.status,
    ).toBe("down");
    expect(
      snapshot?.services.find((service) => service.id === "cloud")?.status,
    ).toBe("degraded");
    expect(
      snapshot?.services.find((service) => service.id === "deep-health")
        ?.status,
    ).toBe("down");
    const incident = await c.incidents.findOne({ _id: "betterstack:34" });
    expect(
      incident?.evidence.some((e) => e.detail?.includes("private-host")),
    ).toBe(true);
    expect(incident?.enrichmentSentAt).toBeTruthy();
    expect(comments).toBe(1);
    expect(await c.timings.countDocuments()).toBe(1);
    expect((await c.timings.findOne({}))?.total).toBe(420);
    const samples = await c.samples.countDocuments();
    await collectStatus();
    expect(await c.samples.countDocuments()).toBe(samples);
    expect(await c.timings.countDocuments()).toBe(1);
    expect(comments).toBe(1);
    expect(await c.daily.countDocuments()).toBe(samples);
  });
  test("provider failure retains incidents and never turns stale monitors green", async () => {
    failBetterStack = true;
    await collectStatus();
    const c = await collections();
    const snapshot = await c.snapshots.findOne({ _id: "latest" });
    expect(
      snapshot?.warnings.some((warning) => warning.includes("Better Stack")),
    ).toBe(true);
    expect(
      snapshot?.services.find((service) => service.id === "heartbeat:9")
        ?.status,
    ).toBe("unknown");
    expect(
      (await c.incidents.findOne({ _id: "betterstack:34" }))?.resolvedAt,
    ).toBeNull();
  });
  test("an active lease prevents overlapping collection", async () => {
    const c = await collections();
    await c.leases.updateOne(
      { _id: "collector" },
      {
        $set: {
          until: new Date(Date.now() + 10000),
          owner: "other-invocation",
        },
      },
    );
    expect((await collectStatus()).skipped).toBe(true);
  });
});
