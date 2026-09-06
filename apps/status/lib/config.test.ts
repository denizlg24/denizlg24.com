import { describe, expect, test } from "bun:test";
import { catalog } from "./catalog";
import {
  bindingTarget,
  type DiscoveredSource,
  defaultBinding,
  emptyConfig,
  resolveBinding,
  resolveServices,
  type StatusConfig,
} from "./config";
import { probeApp } from "./probe";

const source = (
  overrides: Partial<DiscoveredSource> & Pick<DiscoveredSource, "kind">,
): DiscoveredSource => ({
  _id: `${overrides.kind}:1`,
  externalId: "1",
  name: "Source",
  url: null,
  monitorType: null,
  upstreamStatus: null,
  lastCheckedAt: null,
  lastSeenAt: new Date().toISOString(),
  missingSince: null,
  ...overrides,
});
const configWith = (overrides: Partial<StatusConfig>): StatusConfig => ({
  ...emptyConfig,
  ...overrides,
});
const service = (id: string, group = "Applications", name = id) => ({
  id,
  name,
  group,
  description: `About ${id}`,
  status: "operational" as const,
  checkedAt: null,
  latencyMs: null,
  evidence: [],
});

describe("Better Stack sources are chosen, not discovered", () => {
  test("a monitor pointed somewhere else never reaches the page", () => {
    const google = source({
      kind: "monitor",
      _id: "monitor:4897079",
      externalId: "4897079",
      name: "google.com",
      url: "https://google.com",
    });
    const binding = defaultBinding(google, {});
    expect(binding.kind).toBe("ignore");
    expect(bindingTarget(binding, google._id)).toBeNull();
  });
  test("heartbeats are ignored until they are chosen", () => {
    const beat = source({ kind: "heartbeat", _id: "heartbeat:9" });
    expect(defaultBinding(beat, {}).kind).toBe("ignore");
    const chosen = resolveBinding(
      configWith({
        bindings: {
          "heartbeat:9": {
            kind: "own",
            name: "Pi heartbeat",
            group: "Other services",
            description: "",
          },
        },
      }),
      beat,
      {},
    );
    expect(bindingTarget(chosen, beat._id)).toBe("heartbeat:9");
  });
  test("our own origins bind to the service they belong to", () => {
    for (const [url, expected] of [
      ["https://cloud.denizlg24.com", "cloud"],
      ["https://api.denizlg24.com/healthz", "api"],
      ["https://api.denizlg24.com/healthz/deep", "deep-health"],
    ] as const)
      expect(
        bindingTarget(
          defaultBinding(source({ kind: "monitor", url }), {}),
          "monitor:1",
        ),
      ).toBe(expected);
  });
  test("an explicit binding overrides the derived one", () => {
    const monitor = source({
      kind: "monitor",
      _id: "monitor:12",
      externalId: "12",
      url: "https://cloud.denizlg24.com",
    });
    const binding = resolveBinding(
      configWith({
        bindings: { "monitor:12": { kind: "service", serviceId: "forge" } },
      }),
      monitor,
      {},
    );
    expect(bindingTarget(binding, monitor._id)).toBe("forge");
  });
});
describe("configured services", () => {
  const observed = [
    service("cloud", "Applications", "Cloud"),
    service("forge", "Applications", "Forge"),
    service("redis", "Data & storage", "Redis"),
  ];
  test("a hidden service leaves the page entirely", () => {
    const resolved = resolveServices(
      observed,
      configWith({ services: { forge: { visible: false } } }),
    );
    expect(resolved.map((item) => item.id)).toEqual(["cloud", "redis"]);
  });
  test("overrides replace the label without touching the identity", () => {
    const [first] = resolveServices(
      observed,
      configWith({
        services: {
          cloud: {
            name: "Projects",
            description: "Mine",
            group: "Applications",
          },
        },
      }),
    );
    expect(first).toMatchObject({
      id: "cloud",
      name: "Projects",
      description: "Mine",
    });
  });
  test("a blank override falls back rather than blanking the tile", () => {
    const [first] = resolveServices(
      observed,
      configWith({ services: { cloud: { name: "  ", description: "" } } }),
    );
    expect(first?.name).toBe("Cloud");
    expect(first?.description).toBe("About cloud");
  });
  test("explicit order wins inside a group, groups keep their order", () => {
    const resolved = resolveServices(
      observed,
      configWith({ services: { forge: { order: 0 }, cloud: { order: 1 } } }),
    );
    expect(resolved.map((item) => item.id)).toEqual([
      "forge",
      "cloud",
      "redis",
    ]);
  });
  test("the default order is the catalog's", () => {
    const resolved = resolveServices(catalog, emptyConfig);
    expect(resolved.map((item) => item.id).slice(0, 3)).toEqual([
      "cloud",
      "forge",
      "storage",
    ]);
  });
});
describe("application liveness", () => {
  const respond = (status: number, body = "") =>
    ({ status, text: async () => body }) satisfies Awaited<
      ReturnType<Parameters<typeof probeApp>[2] & object>
    >;
  const fetcherFor = (
    routes: Record<string, { status: number; body?: string }>,
  ) => {
    const seen: string[] = [];
    return {
      seen,
      fetcher: async (input: URL) => {
        seen.push(input.pathname);
        const route = routes[input.pathname];
        if (!route) throw new Error("ECONNREFUSED");
        return respond(route.status, route.body ?? "");
      },
    };
  };
  test("the contract response is operational", async () => {
    const { fetcher } = fetcherFor({
      "/healthz": { status: 200, body: '{"status":"ok","service":"cloud"}' },
    });
    const result = await probeApp("cloud", "https://cloud.test", fetcher);
    expect(result.status).toBe("operational");
    expect(result.detail).toBeNull();
  });
  // The failure this whole module exists for: /healthz not deployed yet, while
  // the app itself is serving every request put to it.
  test("a missing health route falls back to the root instead of going dark", async () => {
    const { fetcher, seen } = fetcherFor({
      "/healthz": { status: 404, body: "<!DOCTYPE html>" },
      "/": { status: 200, body: "<!DOCTYPE html>" },
    });
    const result = await probeApp("cloud", "https://cloud.test", fetcher);
    expect(result.status).toBe("operational");
    expect(result.detail).toContain("root is reachable");
    expect(seen).toEqual(["/healthz", "/"]);
  });
  test("a health route shadowed by a page also falls back", async () => {
    const { fetcher } = fetcherFor({
      "/healthz": { status: 200, body: "<!DOCTYPE html>" },
      "/": { status: 200, body: "<!DOCTYPE html>" },
    });
    expect(
      (await probeApp("forge", "https://forge.test", fetcher)).status,
    ).toBe("operational");
  });
  test("a health response identifying another app is reported, not downgraded", async () => {
    const { fetcher } = fetcherFor({
      "/healthz": { status: 200, body: '{"status":"ok"}' },
    });
    const named = fetcherFor({
      "/healthz": { status: 200, body: '{"status":"ok","service":"other"}' },
    });
    expect((await probeApp("macros", "https://m.test", fetcher)).status).toBe(
      "operational",
    );
    const mismatch = await probeApp("macros", "https://m.test", named.fetcher);
    expect(mismatch.status).toBe("operational");
    expect(mismatch.detail).toContain("other");
  });
  test("a reported failure is taken at its word", async () => {
    const { fetcher } = fetcherFor({
      "/healthz": { status: 503, body: '{"status":"unavailable"}' },
    });
    expect((await probeApp("web", "https://web.test", fetcher)).status).toBe(
      "down",
    );
  });
  test("nothing answering at all is an outage", async () => {
    const { fetcher } = fetcherFor({});
    const result = await probeApp("web", "https://web.test", fetcher);
    expect(result.status).toBe("down");
    expect(result.detail).toContain("root did not respond");
  });
  test("a gated app is unknown rather than down", async () => {
    const { fetcher } = fetcherFor({
      "/healthz": { status: 401 },
    });
    expect((await probeApp("web", "https://web.test", fetcher)).status).toBe(
      "unknown",
    );
  });
  test("an app answering but broken at the root is degraded", async () => {
    const { fetcher } = fetcherFor({
      "/healthz": { status: 404, body: "nope" },
      "/": { status: 404, body: "nope" },
    });
    expect((await probeApp("web", "https://web.test", fetcher)).status).toBe(
      "degraded",
    );
  });
});
