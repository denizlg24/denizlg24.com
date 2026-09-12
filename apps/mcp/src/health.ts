import type { McpConfig } from "./config";
import type { ServiceTokens } from "./upstream";

export interface HealthReport {
  status: "ok" | "degraded";
  service: "mcp";
  /** Coarse on purpose: the route is public and the token error carries the issuer's response body. */
  upstream: "ok" | "unconfigured" | "unavailable" | "timeout";
}

// /healthz is unauthenticated and the check it runs is a token request to
// the issuer, so the verdict is held long enough that polling the route
// cannot become a stream of client_credentials grants. A successful token is
// cached by ServiceTokens for its lifetime anyway; the hold matters when it
// fails, which is the case that would otherwise retry on every probe.
const HOLD_MS = 60_000;
// Below the status collector's 8 s probe timeout, or a hanging issuer turns
// "degraded" into "no answer".
const WAIT_MS = 5_000;

export function createHealthReporter(
  config: McpConfig,
  tokens: ServiceTokens,
  now: () => number = Date.now,
): () => Promise<HealthReport> {
  let held: { until: number; report: HealthReport } | null = null;
  let pending: Promise<HealthReport> | null = null;

  const verdict = (upstream: HealthReport["upstream"]): HealthReport => ({
    status: upstream === "ok" ? "ok" : "degraded",
    service: "mcp",
    upstream,
  });
  const check = async (): Promise<HealthReport> => {
    if (!config.service) return verdict("unconfigured");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<HealthReport>((resolve) => {
      timer = setTimeout(() => resolve(verdict("timeout")), WAIT_MS);
    });
    const minted = tokens.forResource(config.cloud.resource).then(
      () => verdict("ok"),
      (error: unknown) => {
        console.warn("MCP service client check failed", error);
        return verdict("unavailable");
      },
    );
    return Promise.race([minted, expired]).finally(() => clearTimeout(timer));
  };

  return () => {
    if (held && held.until > now()) return Promise.resolve(held.report);
    pending ??= check()
      .then((report) => {
        held = { until: now() + HOLD_MS, report };
        return report;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  };
}
