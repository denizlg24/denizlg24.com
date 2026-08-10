import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { DeploymentRoute, RouteManager } from "./run";

export const DEFAULT_ADMIN_URL = "http://127.0.0.1:2019";
export const DEFAULT_ADMIN_LISTEN = "127.0.0.1:2019";

/**
 * The `host:port` Caddy should bind its admin endpoint to, derived from the URL
 * the agent talks to so the config it publishes cannot disagree with it.
 */
export function adminListenFromUrl(adminUrl: string): string {
  try {
    const parsed = new URL(adminUrl);
    const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
    return `${parsed.hostname}:${port}`;
  } catch {
    return DEFAULT_ADMIN_LISTEN;
  }
}
export const DEFAULT_LISTEN = "127.0.0.1:8080";
export const SERVER_NAME = "forge";

export interface CaddyRouteEntry {
  deploymentId: string;
  projectSlug: string;
  hostnames: string[];
  upstream: string;
  /**
   * Names that answer with a 308 to `canonical` instead of serving. Optional
   * so an entry restored from a state file written before redirects existed
   * keeps serving every name rather than losing them.
   */
  redirectHostnames?: string[];
  canonical?: string | null;
  /** Explicit per-domain redirects. Missing on state written by older agents. */
  redirects?: { hostname: string; to: string }[];
}

interface CaddyConfigRoute {
  match?: { host: string[] }[];
  handle: Record<string, unknown>[];
}

interface CaddyLogSink {
  writer: {
    output: "file";
    filename: string;
    roll_size_mb: number;
    roll_keep: number;
  };
  encoder: { format: "json" };
  include: string[];
  level: "INFO";
}

export interface CaddyConfig {
  /**
   * Emitted on purpose, and it is not cosmetic. A `/load` whose body omits
   * `admin` does not leave the running admin endpoint alone — Caddy *relocates*
   * it to the default `localhost:2019`. On this host the bootstrap file happens
   * to name that same address, so the move has always been invisible; point
   * `CADDY_ADMIN_URL` anywhere else and the first publish silently moves Caddy's
   * admin endpoint out from under the agent, which then cannot reach Caddy again
   * until the process restarts. Declaring it keeps the two in agreement.
   */
  admin: { listen: string };
  /**
   * Also erased by every `/load`, which is why the bootstrap file's `logging`
   * block never survived the first publish either. The `default` logger carries
   * an `exclude` for every access logger so request lines go to their file and
   * not to the journal as well.
   */
  logging: {
    logs: Record<string, CaddyLogSink | { level: "ERROR"; exclude: string[] }>;
  };
  apps: {
    http: {
      servers: Record<
        string,
        {
          listen: string[];
          routes: CaddyConfigRoute[];
          automatic_https: { disable: true };
          logs?: { logger_names: Record<string, string[]> };
        }
      >;
    };
  };
}

export interface CaddyLogger {
  info: (message: string, fields?: Record<string, unknown>) => void;
  error: (message: string, fields?: Record<string, unknown>) => void;
}

export interface CaddyRouterOptions {
  statePath: string;
  adminUrl?: string;
  listen?: string;
  accessLogRoot?: string;
  timeoutMs?: number;
  fetchImplementation?: typeof fetch;
  logger?: CaddyLogger;
}

export class CaddyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaddyError";
  }
}

const NOOP_LOGGER: CaddyLogger = { info: () => {}, error: () => {} };
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * cloudflared speaks plain HTTP to Caddy. Without this the app sees `http` and
 * generates `http://` absolute URLs, and anything doing an HTTPS redirect
 * redirects to itself forever.
 */
function proxyHandler(upstream: string): Record<string, unknown> {
  return {
    handler: "reverse_proxy",
    upstreams: [{ dial: upstream }],
    headers: { request: { set: { "X-Forwarded-Proto": ["https"] } } },
  };
}

/**
 * 308 rather than 301: it is the only redirect status that forbids rewriting
 * the method, so a POST to an alias reaches the canonical name as a POST. A 301
 * turns it into a GET and the request is silently lost.
 *
 * The path and query are carried across whole — a redirect that drops them
 * sends every deep link to the front page, which reads as the alias being
 * broken rather than aliased.
 */
function redirectHandler(canonical: string): Record<string, unknown> {
  return {
    handler: "static_response",
    status_code: 308,
    headers: { Location: [`https://${canonical}{http.request.uri}`] },
  };
}

export const DEFAULT_ACCESS_LOG_ROOT = "/srv/forge/access";
const ACCESS_LOG_ROLL_SIZE_MB = 16;
const ACCESS_LOG_ROLL_KEEP = 2;

/**
 * Caddy logger ids may not contain a `.` — the name is a node in a dotted
 * namespace, so `dpl.abc` would nest under a `dpl` logger that does not exist.
 * A deployment id is a UUID, which is safe, but this keeps that a property of
 * the code rather than of the id format.
 */
export function accessLoggerName(deploymentId: string): string {
  return `access-${deploymentId.replaceAll(".", "-")}`;
}

export function accessLogPath(root: string, deploymentId: string): string {
  return `${root}/${deploymentId}.log`;
}

export interface BuildCaddyConfigOptions {
  listen?: string;
  adminListen?: string;
  accessLogRoot?: string;
}

export function buildCaddyConfig(
  entries: readonly CaddyRouteEntry[],
  options: BuildCaddyConfigOptions | string = {},
): CaddyConfig {
  // Kept callable with a bare listen string so the state-restore path and the
  // existing tests do not have to know about the rest of this.
  const resolved: BuildCaddyConfigOptions =
    typeof options === "string" ? { listen: options } : options;
  const listen = resolved.listen ?? DEFAULT_LISTEN;
  const adminListen = resolved.adminListen ?? DEFAULT_ADMIN_LISTEN;
  const accessLogRoot = resolved.accessLogRoot ?? DEFAULT_ACCESS_LOG_ROOT;
  // Sorted so an unchanged set of deployments always serialises identically —
  // otherwise every republish looks like a change and Caddy reloads for nothing.
  const sorted = [...entries].sort((a, b) =>
    (a.hostnames[0] ?? "").localeCompare(b.hostnames[0] ?? ""),
  );
  const routes: CaddyConfigRoute[] = sorted
    .filter((entry) => entry.hostnames.length > 0)
    .flatMap((entry) => {
      const serve: CaddyConfigRoute = {
        match: [{ host: [...entry.hostnames].sort() }],
        handle: [proxyHandler(entry.upstream)],
      };
      // Read legacy state as one canonical group, but every newly published
      // route carries independent source/destination pairs.
      const configured =
        entry.redirects ??
        (entry.canonical
          ? (entry.redirectHostnames ?? []).map((hostname) => ({
              hostname,
              to: entry.canonical as string,
            }))
          : []);
      const byDestination = new Map<string, string[]>();
      for (const redirect of configured) {
        if (entry.hostnames.includes(redirect.hostname)) continue;
        const aliases = byDestination.get(redirect.to) ?? [];
        aliases.push(redirect.hostname);
        byDestination.set(redirect.to, aliases);
      }
      return [
        serve,
        ...[...byDestination.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([destination, aliases]) => ({
            match: [{ host: [...aliases].sort() }],
            handle: [redirectHandler(destination)],
          })),
      ];
    });

  routes.push({
    handle: [
      {
        handler: "static_response",
        status_code: 404,
        body: "no deployment for this hostname",
      },
    ],
  });

  // One logger per deployment, so a request log is already separated by the time
  // anything reads it — the alternative is one shared file that every consumer
  // has to filter by host, and hosts move between deployments on promote.
  const loggerNames: Record<string, string[]> = {};
  const sinks: Record<string, CaddyLogSink> = {};
  for (const entry of sorted) {
    if (entry.hostnames.length === 0) continue;
    const logger = accessLoggerName(entry.deploymentId);
    sinks[logger] = {
      writer: {
        output: "file",
        filename: accessLogPath(accessLogRoot, entry.deploymentId),
        roll_size_mb: ACCESS_LOG_ROLL_SIZE_MB,
        roll_keep: ACCESS_LOG_ROLL_KEEP,
      },
      encoder: { format: "json" },
      include: [`http.log.access.${logger}`],
      level: "INFO",
    };
    // Only names that serve. A redirect answers 308 without reaching the
    // container, and logging it against the deployment would count traffic the
    // app never saw.
    for (const hostname of [...entry.hostnames].sort()) {
      loggerNames[hostname] = [logger];
    }
  }

  return {
    admin: { listen: adminListen },
    logging: {
      logs: {
        default: {
          level: "ERROR",
          exclude: Object.keys(sinks)
            .sort()
            .map((logger) => `http.log.access.${logger}`),
        },
        ...sinks,
      },
    },
    apps: {
      http: {
        servers: {
          [SERVER_NAME]: {
            listen: [listen],
            routes,
            // TLS terminates at Cloudflare; cloudflared reaches this listener
            // over plain HTTP. Caddy turns automatic HTTPS on for any server
            // carrying host matchers, which would both serve TLS on this port —
            // answering every tunnel request with "Client sent an HTTP request
            // to an HTTPS server" — and start an ACME order per deployment
            // hostname that nothing can complete.
            automatic_https: { disable: true },
            ...(Object.keys(loggerNames).length > 0
              ? { logs: { logger_names: loggerNames } }
              : {}),
          },
        },
      },
    },
  };
}

/**
 * Whether Caddy refused the config over a log writer rather than over routing.
 *
 * Matched on Caddy's own wording (`setting up custom log 'name': opening log
 * writer ...`) because the status code cannot tell the two apart — both are a
 * 400. A false negative just means the error propagates as before, which is the
 * safe direction.
 */
function isLoggerRejection(detail: string): boolean {
  return (
    detail.includes("setting up custom log") ||
    detail.includes("opening log writer")
  );
}

/** The same config with every access-log declaration stripped out. */
function withoutAccessLogging(config: CaddyConfig): CaddyConfig {
  return {
    admin: config.admin,
    logging: { logs: { default: { level: "ERROR", exclude: [] } } },
    apps: {
      http: {
        servers: Object.fromEntries(
          Object.entries(config.apps.http.servers).map(([name, server]) => [
            name,
            {
              listen: server.listen,
              routes: server.routes,
              automatic_https: server.automatic_https,
            },
          ]),
        ),
      },
    },
  };
}

/**
 * The agent owns Caddy's config outright: no Caddyfile, and every change is a
 * full `POST /load`. Patching individual route indices is the alternative and
 * it is a trap — an index computed before a concurrent delete addresses the
 * wrong route, and the symptom is one hostname silently serving another app.
 */
export class CaddyRouter implements RouteManager {
  readonly #options: CaddyRouterOptions;
  readonly #logger: CaddyLogger;
  readonly #fetch: typeof fetch;
  readonly #entries = new Map<string, CaddyRouteEntry>();
  #chain: Promise<unknown> = Promise.resolve();

  constructor(options: CaddyRouterOptions) {
    this.#options = options;
    this.#logger = options.logger ?? NOOP_LOGGER;
    this.#fetch = options.fetchImplementation ?? fetch;
  }

  routes(): CaddyRouteEntry[] {
    return [...this.#entries.values()];
  }

  config(): CaddyConfig {
    return buildCaddyConfig(this.routes(), {
      listen: this.#options.listen,
      adminListen: adminListenFromUrl(
        this.#options.adminUrl ?? DEFAULT_ADMIN_URL,
      ),
      accessLogRoot: this.#options.accessLogRoot,
    });
  }

  /**
   * Caddy with no Caddyfile starts empty, so a Caddy restart black-holes every
   * live deployment until something happens to redeploy it. Replaying the last
   * config we wrote closes that window at agent start.
   */
  async restore(): Promise<number> {
    const file = Bun.file(this.#options.statePath);
    if (!(await file.exists())) return 0;

    let entries: CaddyRouteEntry[];
    try {
      const parsed: unknown = await file.json();
      entries = Array.isArray(parsed) ? (parsed as CaddyRouteEntry[]) : [];
    } catch (error) {
      this.#logger.error("could not read the persisted route table", {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }

    this.#entries.clear();
    for (const entry of entries) {
      if (!entry?.deploymentId) continue;
      this.#entries.set(entry.deploymentId, entry);
      this.#claimHostnames(entry);
    }
    await this.#serialise(() => this.#apply());
    return this.#entries.size;
  }

  async publish(route: DeploymentRoute): Promise<void> {
    await this.publishEntry({
      deploymentId: route.deploymentId,
      projectSlug: route.projectSlug,
      hostnames: [route.hostname],
      upstream: `127.0.0.1:${route.port}`,
    });
  }

  async publishEntry(entry: CaddyRouteEntry): Promise<void> {
    await this.#serialise(async () => {
      const previous = new Map(this.#entries);
      this.#entries.set(entry.deploymentId, entry);
      this.#claimHostnames(entry);
      try {
        await this.#apply();
      } catch (error) {
        // The in-memory table is what the next /load is built from. Leaving a
        // route in it that Caddy rejected would smuggle the bad config into
        // every subsequent deploy's reload.
        this.#entries.clear();
        for (const [deploymentId, previousEntry] of previous) {
          this.#entries.set(deploymentId, previousEntry);
        }
        throw error;
      }
    });
  }

  /**
   * A hostname has exactly one owner. Promotions used to add the stable name
   * to the new deployment without removing it from the old one, so whichever
   * route Caddy sorted first won — often a stopped container. Later entries
   * win during restore, matching the order in which routes were published.
   */
  #claimHostnames(entry: CaddyRouteEntry): void {
    const claimed = new Set([
      ...entry.hostnames,
      ...(entry.redirects ?? []).map((redirect) => redirect.hostname),
      ...(entry.redirectHostnames ?? []),
    ]);
    if (claimed.size === 0) return;

    for (const [deploymentId, existing] of this.#entries) {
      if (deploymentId === entry.deploymentId) continue;
      const hostnames = existing.hostnames.filter(
        (hostname) => !claimed.has(hostname),
      );
      const redirects = existing.redirects?.filter(
        (redirect) => !claimed.has(redirect.hostname),
      );
      const redirectHostnames = existing.redirectHostnames?.filter(
        (hostname) => !claimed.has(hostname),
      );
      if (
        hostnames.length === existing.hostnames.length &&
        redirects?.length === existing.redirects?.length &&
        redirectHostnames?.length === existing.redirectHostnames?.length
      ) {
        continue;
      }
      this.#entries.set(deploymentId, {
        ...existing,
        hostnames,
        redirects,
        redirectHostnames,
      });
    }
  }

  /**
   * Promote, rollback and a domain rename are all this: the upstream does not
   * move, the set of names pointing at it does. Rehosting rather than
   * republishing keeps the port out of the caller's hands, which matters
   * because the control plane's copy of it can be a deploy behind.
   */
  async rehost(
    deploymentId: string,
    hostnames: string[],
    options: { redirects?: { hostname: string; to: string }[] } = {},
  ): Promise<boolean> {
    const existing = this.#entries.get(deploymentId);
    if (!existing) return false;
    const redirects = (options.redirects ?? []).map((entry) => ({ ...entry }));
    const destinations = new Set(redirects.map((entry) => entry.to));
    const legacyCanonical =
      destinations.size === 1 ? [...destinations][0] : null;
    await this.publishEntry({
      ...existing,
      hostnames: [...hostnames],
      // Always replaced, never merged. Every caller sends the complete set, so
      // merging would leave a name redirecting after the domain that created
      // it was deleted.
      redirects,
      redirectHostnames: legacyCanonical
        ? redirects.map((entry) => entry.hostname)
        : [],
      canonical: legacyCanonical,
    });
    return true;
  }

  async withdraw(deploymentId: string): Promise<void> {
    await this.#serialise(async () => {
      const previous = this.#entries.get(deploymentId);
      if (!previous) return;
      this.#entries.delete(deploymentId);
      try {
        await this.#apply();
      } catch (error) {
        this.#entries.set(deploymentId, previous);
        throw error;
      }
    });
  }

  /**
   * Writes run one at a time. Two deployments finishing together would
   * otherwise each build a full config from its own view of the table and the
   * later `/load` would erase the earlier one's route.
   */
  #serialise<T>(task: () => Promise<T>): Promise<T> {
    const result = this.#chain.then(task, task);
    this.#chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async #apply(): Promise<void> {
    const config = this.config();
    try {
      await this.#load(config);
    } catch (error) {
      // Caddy validates the access-log writers as part of the config and rejects
      // the *whole* document if it cannot open one — a 400, not a warning, so the
      // servers never get installed and every deployment stops routing. The one
      // way that happens in practice is `/srv/forge/access` not being writable,
      // which means this unit and `forge-caddy.service` have drifted apart.
      //
      // Routing is worth more than request logs. Retrying without the logging
      // block turns that drift from an outage into a missing feature, and the
      // error is logged either way so it is still findable.
      if (!(error instanceof CaddyError) || !isLoggerRejection(error.message)) {
        throw error;
      }
      this.#logger.error(
        "Caddy rejected the access-log configuration; retrying without it",
        { error: error.message },
      );
      await this.#load(withoutAccessLogging(config));
    }
    await this.#persist();
  }

  async #load(config: CaddyConfig): Promise<void> {
    const url = `${this.#options.adminUrl ?? DEFAULT_ADMIN_URL}/load`;
    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(config),
        signal: AbortSignal.timeout(
          this.#options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        ),
      });
    } catch (error) {
      throw new CaddyError(
        `Caddy admin API unreachable at ${url}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 2_000);
      throw new CaddyError(
        `Caddy rejected the config (${response.status}): ${detail || "no detail"}`,
      );
    }
  }

  async #persist(): Promise<void> {
    const path = this.#options.statePath;
    try {
      await mkdir(dirname(path), { recursive: true });
      // Written whole then renamed: a torn file read at boot would drop routes
      // that are live, which is the one thing this file exists to prevent.
      const temporary = `${path}.tmp`;
      await writeFile(temporary, JSON.stringify(this.routes(), null, 2));
      await rename(temporary, path);
    } catch (error) {
      // Caddy already has the config, so routing is correct right now; what is
      // degraded is recovery from a Caddy restart. Failing the deployment over
      // that would remove a container that is serving traffic.
      this.#logger.error("could not persist the route table", {
        path,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
