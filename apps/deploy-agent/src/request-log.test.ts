import { describe, expect, it } from "bun:test";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withTempDir } from "./fixtures";
import {
  parseAccessLogLine,
  percentile,
  RequestLogStore,
  summariseRequests,
} from "./request-log";

/**
 * A real line, copied from Caddy 2.11.4's json encoder. `request` is merged
 * rather than replaced so a test can move one nested field without restating the
 * whole object — and `uri` silently landing at the top level is exactly the kind
 * of thing that makes a passing test prove nothing.
 */
function line(
  overrides: Record<string, unknown> = {},
  request: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    level: "info",
    ts: 1786356487.8668249,
    logger: "http.log.access.access-dep-1",
    msg: "handled request",
    bytes_read: 0,
    duration: 0.0405,
    size: 2048,
    status: 200,
    ...overrides,
    request: {
      remote_ip: "10.0.0.1",
      remote_port: "51759",
      client_ip: "203.0.113.7",
      proto: "HTTP/1.1",
      method: "GET",
      host: "app.denizlg24.com",
      uri: "/hello?x=1",
      headers: {
        "User-Agent": ["TestAgent/1.0"],
        Referer: ["https://example.com/from"],
      },
      ...request,
    },
  });
}

/** Replaces `request` outright, for the missing-field cases. */
function bareLine(request: Record<string, unknown>): string {
  return JSON.stringify({
    ts: 1786356487.8668249,
    status: 200,
    duration: 0.01,
    size: 1,
    request,
  });
}

async function store(dir: string) {
  const root = join(dir, "access");
  await mkdir(root, { recursive: true });
  return { root, requests: new RequestLogStore({ root }) };
}

describe("parseAccessLogLine", () => {
  it("flattens Caddy's shape and converts seconds to milliseconds", () => {
    expect(parseAccessLogLine(line())).toEqual({
      ts: "2026-08-10T10:08:07.866Z",
      status: 200,
      method: "GET",
      host: "app.denizlg24.com",
      uri: "/hello?x=1",
      proto: "HTTP/1.1",
      durationMs: 40.5,
      bytesOut: 2048,
      clientIp: "203.0.113.7",
      userAgent: "TestAgent/1.0",
      referer: "https://example.com/from",
      requestId: null,
      rayId: null,
      geo: {
        country: null,
        city: null,
        region: null,
        continent: null,
        latitude: null,
        longitude: null,
        colo: null,
      },
    });
  });

  it("reads the visitor from Cloudflare's headers, not the tunnel", () => {
    const record = parseAccessLogLine(
      line(
        {},
        {
          headers: {
            "CF-Connecting-IP": ["198.51.100.42"],
            "CF-IPCountry": ["PT"],
            "CF-IPCity": ["Lisbon"],
            "CF-Region": ["Lisboa"],
            "CF-IPContinent": ["EU"],
            "CF-IPLatitude": ["38.72225"],
            "CF-IPLongitude": ["-9.13934"],
            "CF-Ray": ["9a1f2c3d4e5f6789-LIS"],
            "X-Request-Id": ["1f0c2a44-77bd-4c1e-9c2f-2b1f6b2a55e1"],
          },
        },
      ),
    );
    // `client_ip` is the tunnel's own address on this box, so a record reporting
    // it as the visitor is the bug this replaces.
    expect(record?.clientIp).toBe("198.51.100.42");
    expect(record?.rayId).toBe("9a1f2c3d4e5f6789");
    expect(record?.requestId).toBe("1f0c2a44-77bd-4c1e-9c2f-2b1f6b2a55e1");
    expect(record?.geo).toEqual({
      country: "PT",
      city: "Lisbon",
      region: "Lisboa",
      continent: "EU",
      latitude: 38.72225,
      longitude: -9.13934,
      colo: "LIS",
    });
  });

  // Cloudflare rewrites header casing depending on which product set it, so a
  // case-sensitive lookup silently reports every field as absent.
  it("matches Cloudflare headers whatever their casing", () => {
    const record = parseAccessLogLine(
      line({}, { headers: { "cf-connecting-ip": ["203.0.113.9"] } }),
    );
    expect(record?.clientIp).toBe("203.0.113.9");
  });

  // `XX` is Cloudflare saying it could not place the address. Rendered as-is it
  // becomes a country named XX in every breakdown.
  it("reads an unplaceable country as no country", () => {
    const record = parseAccessLogLine(
      line({}, { headers: { "CF-IPCountry": ["XX"] } }),
    );
    expect(record?.geo.country).toBeNull();
  });

  it("prefers client_ip but falls back to remote_ip", () => {
    const record = parseAccessLogLine(
      bareLine({
        remote_ip: "10.0.0.1",
        proto: "HTTP/2.0",
        method: "GET",
        host: "h",
        uri: "/",
      }),
    );
    expect(record?.clientIp).toBe("10.0.0.1");
  });

  it("reports a missing user agent as null rather than empty", () => {
    const record = parseAccessLogLine(
      bareLine({
        client_ip: "1.1.1.1",
        proto: "HTTP/1.1",
        method: "GET",
        host: "h",
        uri: "/",
        headers: {},
      }),
    );
    expect(record?.userAgent).toBeNull();
    expect(record?.referer).toBeNull();
  });

  // The file is appended to by another process while being read, so a truncated
  // final line is normal rather than exceptional.
  it("returns null for anything it cannot use, without throwing", () => {
    expect(parseAccessLogLine("")).toBeNull();
    expect(parseAccessLogLine("   ")).toBeNull();
    expect(parseAccessLogLine('{"ts":1786,"stat')).toBeNull();
    expect(parseAccessLogLine("not json at all")).toBeNull();
    expect(
      parseAccessLogLine(JSON.stringify({ ts: 1, status: 200 })),
    ).toBeNull();
    expect(parseAccessLogLine(line({ ts: "nope" }))).toBeNull();
    expect(parseAccessLogLine(line({ status: 20.5 }))).toBeNull();
  });
});

describe("percentile", () => {
  it("returns an observed value, never an interpolated one", () => {
    const sorted = [10, 20, 30, 40];
    expect(percentile(sorted, 0.5)).toBe(20);
    expect(percentile(sorted, 0.95)).toBe(40);
    expect(percentile([], 0.5)).toBe(0);
    expect(percentile([7], 0.95)).toBe(7);
  });
});

describe("summariseRequests", () => {
  it("classifies by status and totals bytes", () => {
    const records = [200, 204, 301, 404, 500, 503].map(
      (status, index) =>
        parseAccessLogLine(
          line({ status, size: 100, duration: (index + 1) / 1000 }),
        ) as NonNullable<ReturnType<typeof parseAccessLogLine>>,
    );
    const stats = summariseRequests("dep-1", records);

    expect(stats).toMatchObject({
      deploymentId: "dep-1",
      count: 6,
      status2xx: 2,
      status3xx: 1,
      status4xx: 1,
      status5xx: 2,
      bytesOut: 600,
    });
    expect(stats.durationP50Ms).toBeCloseTo(3, 5);
    expect(stats.durationP95Ms).toBeCloseTo(6, 5);
  });

  // Counting a 1xx as a success would report an outcome that has not happened.
  it("counts a 1xx without putting it in a class", () => {
    const record = parseAccessLogLine(line({ status: 101 }));
    const stats = summariseRequests("dep-1", [record as never]);
    expect(stats.count).toBe(1);
    expect(stats.status2xx).toBe(0);
    expect(stats.status3xx).toBe(0);
  });

  it("reports zeroes for an empty interval", () => {
    expect(summariseRequests("dep-1", [])).toEqual({
      deploymentId: "dep-1",
      count: 0,
      status2xx: 0,
      status3xx: 0,
      status4xx: 0,
      status5xx: 0,
      bytesOut: 0,
      durationP50Ms: 0,
      durationP95Ms: 0,
    });
  });
});

describe("RequestLogStore.drain", () => {
  it("seeks to the end on the first call so a cold start reports no spike", async () => {
    await withTempDir(async (dir) => {
      const { root, requests } = await store(dir);
      await writeFile(join(root, "dep-1.log"), `${line()}\n${line()}\n`);

      expect(await requests.drain("dep-1")).toEqual([]);
      await appendFile(join(root, "dep-1.log"), `${line()}\n`);
      expect(await requests.drain("dep-1")).toHaveLength(1);
    });
  });

  it("returns nothing twice", async () => {
    await withTempDir(async (dir) => {
      const { root, requests } = await store(dir);
      await writeFile(join(root, "dep-1.log"), "");
      await requests.drain("dep-1");

      await appendFile(join(root, "dep-1.log"), `${line()}\n${line()}\n`);
      expect(await requests.drain("dep-1")).toHaveLength(2);
      expect(await requests.drain("dep-1")).toEqual([]);
    });
  });

  it("carries a record split across a read boundary", async () => {
    await withTempDir(async (dir) => {
      const { root, requests } = await store(dir);
      const path = join(root, "dep-1.log");
      await writeFile(path, "");
      await requests.drain("dep-1");

      // Bigger than the 64 KiB read chunk, so the final record spans two reads.
      const padded = `${line({}, { uri: `/${"a".repeat(70_000)}` })}\n${line()}\n`;
      await appendFile(path, padded);
      const drained = await requests.drain("dep-1");
      expect(drained).toHaveLength(2);
      expect(drained[0]?.uri.length).toBeGreaterThan(70_000);
    });
  });

  it("holds a half-written final line until its newline arrives", async () => {
    await withTempDir(async (dir) => {
      const { root, requests } = await store(dir);
      const path = join(root, "dep-1.log");
      await writeFile(path, "");
      await requests.drain("dep-1");

      const whole = line();
      await appendFile(path, whole.slice(0, 40));
      expect(await requests.drain("dep-1")).toEqual([]);
      await appendFile(path, `${whole.slice(40)}\n`);
      expect(await requests.drain("dep-1")).toHaveLength(1);
    });
  });

  it("restarts from the beginning when the file has rolled", async () => {
    await withTempDir(async (dir) => {
      const { root, requests } = await store(dir);
      const path = join(root, "dep-1.log");
      await writeFile(path, `${line()}\n${line()}\n${line()}\n`);
      await requests.drain("dep-1");

      // Caddy rolls by renaming and opening a fresh, shorter file.
      await writeFile(path, `${line()}\n`);
      expect(await requests.drain("dep-1")).toHaveLength(1);
    });
  });

  it("treats a missing file as no traffic", async () => {
    await withTempDir(async (dir) => {
      const { requests } = await store(dir);
      expect(await requests.drain("never-deployed")).toEqual([]);
    });
  });

  it("forgets a deployment so a later file is read from its end again", async () => {
    await withTempDir(async (dir) => {
      const { root, requests } = await store(dir);
      const path = join(root, "dep-1.log");
      await writeFile(path, "");
      await requests.drain("dep-1");
      requests.forget("dep-1");

      await appendFile(path, `${line()}\n`);
      expect(await requests.drain("dep-1")).toEqual([]);
    });
  });
});

describe("RequestLogStore.tail", () => {
  it("returns the newest records last", async () => {
    await withTempDir(async (dir) => {
      const { root, requests } = await store(dir);
      const lines = [1, 2, 3, 4, 5].map((n) => line({}, { uri: `/p${n}` }));
      await writeFile(join(root, "dep-1.log"), `${lines.join("\n")}\n`);

      const tail = await requests.tail("dep-1", 3);
      expect(tail.requests.map((record) => record.uri)).toEqual([
        "/p3",
        "/p4",
        "/p5",
      ]);
    });
  });

  it("does not read the whole file to show a few rows", async () => {
    await withTempDir(async (dir) => {
      const { root, requests } = await store(dir);
      const many = Array.from({ length: 4_000 }, (_, n) =>
        line({}, { uri: `/p${n}` }),
      );
      await writeFile(join(root, "dep-1.log"), `${many.join("\n")}\n`);

      const tail = await requests.tail("dep-1", 5);
      expect(tail.requests).toHaveLength(5);
      expect(tail.requests.at(-1)?.uri).toBe("/p3999");
      // The point of the backwards read: five rows must not cost 4 000 parses.
      expect(tail.scanned).toBeLessThan(200);
    });
  });

  it("copes with a file shorter than the requested limit", async () => {
    await withTempDir(async (dir) => {
      const { root, requests } = await store(dir);
      await writeFile(join(root, "dep-1.log"), `${line()}\n`);
      const tail = await requests.tail("dep-1", 100);
      expect(tail.requests).toHaveLength(1);
      expect(tail.truncated).toBe(false);
    });
  });

  it("returns nothing for an empty or missing file", async () => {
    await withTempDir(async (dir) => {
      const { root, requests } = await store(dir);
      await writeFile(join(root, "dep-1.log"), "");
      expect((await requests.tail("dep-1", 10)).requests).toEqual([]);
      expect((await requests.tail("gone", 10)).requests).toEqual([]);
    });
  });

  it("keeps reading past the limit until it has that many matches", async () => {
    await withTempDir(async (dir) => {
      const { root, requests } = await store(dir);
      // One 500 at the very front, then a thousand 200s. An unfiltered tail of
      // 10 never sees it; the filtered read has to walk back the whole file.
      const lines = [
        line({ status: 500 }, { uri: "/boom" }),
        ...Array.from({ length: 1_000 }, (_, n) =>
          line({ status: 200 }, { uri: `/ok${n}` }),
        ),
      ];
      await writeFile(join(root, "dep-1.log"), `${lines.join("\n")}\n`);

      const tail = await requests.tail("dep-1", 10, {
        statusClasses: ["5xx"],
      });
      expect(tail.requests.map((record) => record.uri)).toEqual(["/boom"]);
      expect(tail.scanned).toBe(1_001);
      expect(tail.truncated).toBe(false);
    });
  });

  it("filters on method, path and duration", async () => {
    await withTempDir(async (dir) => {
      const { root, requests } = await store(dir);
      await writeFile(
        join(root, "dep-1.log"),
        `${[
          line({ duration: 0.005 }, { method: "GET", uri: "/api/fast" }),
          line({ duration: 2 }, { method: "POST", uri: "/api/slow" }),
          line({ duration: 3 }, { method: "GET", uri: "/other/slow" }),
        ].join("\n")}\n`,
      );

      expect(
        (await requests.tail("dep-1", 10, { methods: ["get"] })).requests.map(
          (record) => record.uri,
        ),
      ).toEqual(["/api/fast", "/other/slow"]);
      expect(
        (await requests.tail("dep-1", 10, { search: "/API/" })).requests.map(
          (record) => record.uri,
        ),
      ).toEqual(["/api/fast", "/api/slow"]);
      expect(
        (
          await requests.tail("dep-1", 10, { minDurationMs: 1_000 })
        ).requests.map((record) => record.uri),
      ).toEqual(["/api/slow", "/other/slow"]);
    });
  });
});
