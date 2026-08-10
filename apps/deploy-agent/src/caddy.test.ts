import { describe, expect, it } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
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

describe("access-log rejection fallback", () => {
  /**
   * Caddy's real 400 when it cannot open a log writer, copied from 2.11.4. It
   * rejects the whole document, so without a fallback one unwritable directory
   * takes every deployment's routing with it.
   */
  const LOGGER_REJECTION =
    `{"error":"loading config: loading new config: setting up custom log 'access-dep-1': ` +
    `opening log writer using \\u0026logging.FileWriter{Filename:\\"/srv/forge/access/dep-1.log\\"}: ` +
    `open /srv/forge/access/dep-1.log: permission denied"}`;

  function rejectingCaddy(detail: string, rejectAll = false) {
    const loads: Record<string, unknown>[] = [];
    const implementation = fakeFetch(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      loads.push(body);
      const hasLogging =
        Object.keys(
          (body.logging as { logs?: Record<string, unknown> })?.logs ?? {},
        ).length > 1;
      if (rejectAll || hasLogging) {
        return new Response(detail, { status: 400 });
      }
      return new Response("", { status: 200 });
    });
    return { loads, implementation };
  }

  it("republishes without logging so routing survives an unwritable log dir", async () => {
    await withTempDir(async (dir) => {
      const caddy = rejectingCaddy(LOGGER_REJECTION);
      const errors: string[] = [];
      const instance = new CaddyRouter({
        statePath: join(dir, "caddy", "config.json"),
        fetchImplementation: caddy.implementation,
        logger: {
          info: () => {},
          error: (message) => errors.push(message),
        },
      });

      await instance.publish({
        deploymentId: "dep-1",
        projectSlug: "app",
        hostname: "app.denizlg24.com",
        port: 24_817,
      });

      expect(caddy.loads).toHaveLength(2);
      // The retry keeps the routes and drops only the logging.
      const retry = caddy.loads[1] as {
        logging: { logs: Record<string, unknown> };
        apps: { http: { servers: Record<string, { routes: unknown[] }> } };
      };
      expect(Object.keys(retry.logging.logs)).toEqual(["default"]);
      expect(retry.apps.http.servers.forge?.routes).toHaveLength(2);
      expect(retry.apps.http.servers.forge).not.toHaveProperty("logs");
      expect(errors.join(" ")).toContain("retrying without it");
    });
  });

  // A genuinely broken route must still fail loudly; the fallback is only for
  // the log writers.
  it("still throws when the rejection is not about logging", async () => {
    await withTempDir(async (dir) => {
      const caddy = rejectingCaddy("bad handler", true);
      const instance = new CaddyRouter({
        statePath: join(dir, "caddy", "config.json"),
        fetchImplementation: caddy.implementation,
      });

      await expect(
        instance.publish({
          deploymentId: "dep-1",
          projectSlug: "app",
          hostname: "app.denizlg24.com",
          port: 24_817,
        }),
      ).rejects.toThrow(CaddyError);
      expect(caddy.loads).toHaveLength(1);
    });
  });
});

describe("buildCaddyConfig access logging", () => {
  const entry = {
    deploymentId: "dep-1",
    projectSlug: "app",
    hostnames: ["b.denizlg24.com", "a.denizlg24.com"],
    upstream: "127.0.0.1:24817",
  };

  /**
   * Verified against a real Caddy 2.11.4: a `/load` whose body omits `admin`
   * relocates the running admin endpoint to the default `localhost:2019`. It has
   * always been invisible here because the bootstrap names that same address, but
   * a non-default `CADDY_ADMIN_URL` would lose the agent its only way to reach
   * Caddy on the first publish.
   */
  it("always declares the admin endpoint", () => {
    expect(buildCaddyConfig([entry]).admin.listen).toBe("127.0.0.1:2019");
    expect(
      buildCaddyConfig([entry], { adminListen: "127.0.0.1:2020" }).admin.listen,
    ).toBe("127.0.0.1:2020");
  });

  it("gives each deployment its own logger and file", () => {
    const config = buildCaddyConfig([entry], { accessLogRoot: "/access" });
    const logger = "access-dep-1";

    expect(config.apps.http.servers.forge?.logs?.logger_names).toEqual({
      "a.denizlg24.com": [logger],
      "b.denizlg24.com": [logger],
    });
    expect(config.logging.logs[logger]).toEqual({
      writer: {
        output: "file",
        filename: "/access/dep-1.log",
        roll_size_mb: 16,
        roll_keep: 2,
      },
      encoder: { format: "json" },
      include: [`http.log.access.${logger}`],
      level: "INFO",
    });
  });

  // Without the exclude, every request line lands in the journal as well as in
  // its own file.
  it("keeps access lines out of the default logger", () => {
    const config = buildCaddyConfig([entry]);
    expect(config.logging.logs.default).toEqual({
      level: "ERROR",
      exclude: ["http.log.access.access-dep-1"],
    });
  });

  // A redirect answers 308 without reaching the container, so counting it would
  // report traffic the app never served.
  it("does not log redirect-only hostnames against the deployment", () => {
    const config = buildCaddyConfig([
      {
        ...entry,
        hostnames: ["denizlg24.com"],
        redirects: [{ hostname: "www.denizlg24.com", to: "denizlg24.com" }],
      },
    ]);
    expect(
      config.apps.http.servers.forge?.logs?.logger_names,
    ).not.toHaveProperty("www.denizlg24.com");
  });

  it("omits the server logs block when nothing is routed", () => {
    const config = buildCaddyConfig([]);
    expect(config.apps.http.servers.forge?.logs).toBeUndefined();
    expect(config.logging.logs.default).toEqual({
      level: "ERROR",
      exclude: [],
    });
  });

  it("serialises identically for an unchanged set", () => {
    const second = {
      deploymentId: "dep-2",
      projectSlug: "other",
      hostnames: ["z.denizlg24.com"],
      upstream: "127.0.0.1:24818",
    };
    expect(JSON.stringify(buildCaddyConfig([entry, second]))).toBe(
      JSON.stringify(buildCaddyConfig([second, entry])),
    );
  });
});

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

  it("redirects configured aliases to their destination", () => {
    const config = buildCaddyConfig([
      {
        deploymentId: "a",
        projectSlug: "app",
        hostnames: ["denizlg24.com"],
        redirects: [
          { hostname: "www.denizlg24.com", to: "denizlg24.com" },
          { hostname: "old.denizlg24.com", to: "denizlg24.com" },
        ],
        upstream: "127.0.0.1:24817",
      },
    ]);
    const routes = config.apps.http.servers.forge?.routes ?? [];
    const redirect = routes[1];

    expect(redirect?.match?.[0]?.host).toEqual([
      "old.denizlg24.com",
      "www.denizlg24.com",
    ]);
    // 308 keeps the method, so a POST to an alias is not silently turned into
    // a GET, and the URI is carried across so deep links survive.
    const handler = redirect?.handle[0] as
      | { status_code: number; headers: { Location: string[] } }
      | undefined;
    expect(handler?.status_code).toBe(308);
    expect(handler?.headers.Location).toEqual([
      "https://denizlg24.com{http.request.uri}",
    ]);
  });

  it("supports a different destination for each domain", () => {
    const config = buildCaddyConfig([
      {
        deploymentId: "a",
        projectSlug: "app",
        hostnames: ["denizlg24.com", "docs.denizlg24.com"],
        redirects: [
          { hostname: "www.denizlg24.com", to: "denizlg24.com" },
          { hostname: "old.denizlg24.com", to: "docs.denizlg24.com" },
        ],
        upstream: "127.0.0.1:24817",
      },
    ]);
    const routes = config.apps.http.servers.forge?.routes ?? [];

    expect(routes[1]?.match?.[0]?.host).toEqual(["www.denizlg24.com"]);
    expect(routes[1]?.handle[0]?.headers).toEqual({
      Location: ["https://denizlg24.com{http.request.uri}"],
    });
    expect(routes[2]?.match?.[0]?.host).toEqual(["old.denizlg24.com"]);
    expect(routes[2]?.handle[0]?.headers).toEqual({
      Location: ["https://docs.denizlg24.com{http.request.uri}"],
    });
  });

  it("serves every name when there is no canonical to redirect to", () => {
    // The shape an entry restored from a pre-redirect state file has. Serving
    // is the old behaviour; 308ing to nowhere would be an outage.
    const config = buildCaddyConfig([
      {
        deploymentId: "a",
        projectSlug: "app",
        hostnames: ["a.denizlg24.com"],
        redirectHostnames: ["www.denizlg24.com"],
        canonical: null,
        upstream: "127.0.0.1:24817",
      },
    ]);

    expect(config.apps.http.servers.forge?.routes).toHaveLength(2);
  });

  it("never both serves and redirects the same hostname", () => {
    const config = buildCaddyConfig([
      {
        deploymentId: "a",
        projectSlug: "app",
        hostnames: ["a.denizlg24.com", "denizlg24.com"],
        redirects: [{ hostname: "a.denizlg24.com", to: "denizlg24.com" }],
        upstream: "127.0.0.1:24817",
      },
    ]);
    const routes = config.apps.http.servers.forge?.routes ?? [];

    // A name in both sets resolves to whichever route matched first, which is
    // the "one hostname silently serving another app" failure mode.
    expect(routes).toHaveLength(2);
    expect(routes[0]?.match?.[0]?.host).toContain("a.denizlg24.com");
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

  it("moves a promoted hostname away from the previous deployment", async () => {
    await withTempDir(async (dir) => {
      const caddy = fakeCaddy();
      const instance = router(dir, caddy);
      await instance.publish({
        deploymentId: "dep-old",
        projectSlug: "forge",
        hostname: "old.forge.denizlg24.com",
        port: 20_555,
      });
      await instance.rehost("dep-old", [
        "old.forge.denizlg24.com",
        "forge.denizlg24.com",
      ]);
      await instance.publish({
        deploymentId: "dep-new",
        projectSlug: "forge",
        hostname: "new.forge.denizlg24.com",
        port: 21_769,
      });
      await instance.rehost("dep-new", [
        "new.forge.denizlg24.com",
        "forge.denizlg24.com",
      ]);

      expect(instance.routes()).toEqual([
        expect.objectContaining({
          deploymentId: "dep-old",
          hostnames: ["old.forge.denizlg24.com"],
        }),
        expect.objectContaining({
          deploymentId: "dep-new",
          hostnames: ["new.forge.denizlg24.com", "forge.denizlg24.com"],
        }),
      ]);
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

  it("repairs duplicate persisted hostname owners on restore", async () => {
    await withTempDir(async (dir) => {
      const statePath = join(dir, "caddy", "config.json");
      await mkdir(join(dir, "caddy"), { recursive: true });
      await writeFile(
        statePath,
        JSON.stringify([
          {
            deploymentId: "dep-old",
            projectSlug: "forge",
            hostnames: ["old.forge.denizlg24.com", "forge.denizlg24.com"],
            upstream: "127.0.0.1:20555",
          },
          {
            deploymentId: "dep-new",
            projectSlug: "forge",
            hostnames: ["new.forge.denizlg24.com", "forge.denizlg24.com"],
            upstream: "127.0.0.1:21769",
          },
        ]),
      );

      const caddy = fakeCaddy();
      const instance = router(dir, caddy);
      expect(await instance.restore()).toBe(2);
      expect(instance.routes()[0]?.hostnames).toEqual([
        "old.forge.denizlg24.com",
      ]);
      expect(hostsOf(caddy.loads[0] as LoadedConfig)).toEqual([
        ["forge.denizlg24.com", "new.forge.denizlg24.com"],
        ["old.forge.denizlg24.com"],
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
