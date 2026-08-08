import { describe, expect, it } from "bun:test";
import { join } from "node:path";

import { buildCaddyConfig, CaddyError, CaddyRouter } from "./caddy";
import { fakeFetch, withTempDir } from "./fixtures";

interface LoadedConfig {
  apps: {
    http: {
      servers: Record<
        string,
        {
          listen: string[];
          routes: {
            match?: { host: string[] }[];
            handle: Record<string, unknown>[];
          }[];
        }
      >;
    };
  };
}

function fakeCaddy(options: { fail?: boolean } = {}) {
  const loads: LoadedConfig[] = [];
  const implementation = fakeFetch(async (_url, init) => {
    loads.push(JSON.parse(String(init?.body)) as LoadedConfig);
    return options.fail
      ? new Response("bad handler", { status: 400 })
      : new Response("", { status: 200 });
  });
  return { loads, implementation };
}

function router(dir: string, caddy: ReturnType<typeof fakeCaddy>): CaddyRouter {
  return new CaddyRouter({
    statePath: join(dir, "caddy", "config.json"),
    fetchImplementation: caddy.implementation,
  });
}

function hostsOf(config: LoadedConfig): string[][] {
  return (config.apps.http.servers.forge?.routes ?? [])
    .filter((route) => route.match)
    .map((route) => route.match?.[0]?.host ?? []);
}

describe("buildCaddyConfig", () => {
  it("always ends with a catch-all 404", () => {
    const config = buildCaddyConfig([
      {
        deploymentId: "a",
        projectSlug: "app",
        hostnames: ["a.denizlg24.com"],
        upstream: "127.0.0.1:24817",
      },
    ]);
    const routes = config.apps.http.servers.forge?.routes ?? [];
    expect(routes).toHaveLength(2);
    expect(routes.at(-1)?.match).toBeUndefined();
    expect(routes.at(-1)?.handle[0]?.status_code).toBe(404);
  });

  it("tells the app it is behind HTTPS", () => {
    const config = buildCaddyConfig([
      {
        deploymentId: "a",
        projectSlug: "app",
        hostnames: ["a.denizlg24.com"],
        upstream: "127.0.0.1:24817",
      },
    ]);
    const handler = config.apps.http.servers.forge?.routes[0]?.handle[0] as {
      upstreams: { dial: string }[];
      headers: { request: { set: Record<string, string[]> } };
    };
    expect(handler.upstreams).toEqual([{ dial: "127.0.0.1:24817" }]);
    expect(handler.headers.request.set["X-Forwarded-Proto"]).toEqual(["https"]);
  });

  it("serialises the same set of routes identically", () => {
    const entries = [
      {
        deploymentId: "b",
        projectSlug: "app",
        hostnames: ["b.x"],
        upstream: "1",
      },
      {
        deploymentId: "a",
        projectSlug: "app",
        hostnames: ["a.x"],
        upstream: "2",
      },
    ];
    expect(JSON.stringify(buildCaddyConfig(entries))).toBe(
      JSON.stringify(buildCaddyConfig([...entries].reverse())),
    );
  });

  it("drops an entry with no hostname rather than matching everything", () => {
    const config = buildCaddyConfig([
      { deploymentId: "a", projectSlug: "app", hostnames: [], upstream: "1" },
    ]);
    expect(config.apps.http.servers.forge?.routes).toHaveLength(1);
  });
});

describe("CaddyRouter", () => {
  it("loads the full config on publish", async () => {
    await withTempDir(async (dir) => {
      const caddy = fakeCaddy();
      const instance = router(dir, caddy);
      await instance.publish({
        deploymentId: "dep-1",
        projectSlug: "app",
        hostname: "app.denizlg24.com",
        port: 24_817,
      });

      expect(caddy.loads).toHaveLength(1);
      expect(hostsOf(caddy.loads[0] as LoadedConfig)).toEqual([
        ["app.denizlg24.com"],
      ]);
    });
  });

  it("replaces a deployment's own route instead of stacking one", async () => {
    await withTempDir(async (dir) => {
      const caddy = fakeCaddy();
      const instance = router(dir, caddy);
      const route = {
        deploymentId: "dep-1",
        projectSlug: "app",
        hostname: "app.denizlg24.com",
        port: 24_817,
      };
      await instance.publish(route);
      await instance.publish({ ...route, port: 24_900 });

      expect(instance.routes()).toHaveLength(1);
      expect(instance.routes()[0]?.upstream).toBe("127.0.0.1:24900");
    });
  });

  it("keeps every other deployment's route on a withdraw", async () => {
    await withTempDir(async (dir) => {
      const caddy = fakeCaddy();
      const instance = router(dir, caddy);
      await instance.publish({
        deploymentId: "dep-1",
        projectSlug: "app",
        hostname: "a.denizlg24.com",
        port: 1,
      });
      await instance.publish({
        deploymentId: "dep-2",
        projectSlug: "app",
        hostname: "b.denizlg24.com",
        port: 2,
      });
      await instance.withdraw("dep-1");

      expect(hostsOf(caddy.loads.at(-1) as LoadedConfig)).toEqual([
        ["b.denizlg24.com"],
      ]);
    });
  });

  it("does not reload for a withdraw of something it never routed", async () => {
    await withTempDir(async (dir) => {
      const caddy = fakeCaddy();
      await router(dir, caddy).withdraw("dep-unknown");
      expect(caddy.loads).toHaveLength(0);
    });
  });

  it("keeps the rejected route out of the next load", async () => {
    await withTempDir(async (dir) => {
      const caddy = fakeCaddy({ fail: true });
      const instance = router(dir, caddy);
      await expect(
        instance.publish({
          deploymentId: "dep-1",
          projectSlug: "app",
          hostname: "a.denizlg24.com",
          port: 1,
        }),
      ).rejects.toBeInstanceOf(CaddyError);
      expect(instance.routes()).toEqual([]);
    });
  });

  it("reports an unreachable admin API as a Caddy error", async () => {
    await withTempDir(async (dir) => {
      const instance = new CaddyRouter({
        statePath: join(dir, "config.json"),
        fetchImplementation: fakeFetch(async () => {
          throw new Error("ECONNREFUSED");
        }),
      });
      await expect(
        instance.publish({
          deploymentId: "dep-1",
          projectSlug: "app",
          hostname: "a.denizlg24.com",
          port: 1,
        }),
      ).rejects.toThrow(/unreachable/);
    });
  });

  it("serialises concurrent publishes so neither route is lost", async () => {
    await withTempDir(async (dir) => {
      const caddy = fakeCaddy();
      const instance = router(dir, caddy);
      await Promise.all([
        instance.publish({
          deploymentId: "dep-1",
          projectSlug: "app",
          hostname: "a.denizlg24.com",
          port: 1,
        }),
        instance.publish({
          deploymentId: "dep-2",
          projectSlug: "app",
          hostname: "b.denizlg24.com",
          port: 2,
        }),
      ]);
      expect(hostsOf(caddy.loads.at(-1) as LoadedConfig)).toEqual([
        ["a.denizlg24.com"],
        ["b.denizlg24.com"],
      ]);
    });
  });

  it("replays the persisted table into a restarted Caddy", async () => {
    await withTempDir(async (dir) => {
      const statePath = join(dir, "caddy", "config.json");
      const first = new CaddyRouter({
        statePath,
        fetchImplementation: fakeCaddy().implementation,
      });
      await first.publish({
        deploymentId: "dep-1",
        projectSlug: "app",
        hostname: "a.denizlg24.com",
        port: 24_817,
      });

      const caddy = fakeCaddy();
      const second = new CaddyRouter({
        statePath,
        fetchImplementation: caddy.implementation,
      });
      expect(await second.restore()).toBe(1);
      expect(hostsOf(caddy.loads[0] as LoadedConfig)).toEqual([
        ["a.denizlg24.com"],
      ]);
    });
  });

  it("starts empty when there is nothing persisted", async () => {
    await withTempDir(async (dir) => {
      const caddy = fakeCaddy();
      expect(await router(dir, caddy).restore()).toBe(0);
      expect(caddy.loads).toHaveLength(0);
    });
  });
});
