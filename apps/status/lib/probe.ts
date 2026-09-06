import { fromCheck } from "./health";
import type { Health } from "./model";

export type ProbeResult = {
  status: Health;
  detail: string | null;
  latencyMs: number;
};
export type Fetcher = (
  input: URL,
  init: RequestInit,
) => Promise<Pick<Response, "status" | "text">>;

const PROBE_TIMEOUT_MS = 8_000;
/**
 * A gated response tells us the app answered but not whether it is well. Anything
 * else in this set would be read as an outage, which is worse than saying nothing.
 */
const AMBIGUOUS = new Set([401, 403, 407, 429]);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 300) : "Probe failed";
}
function bodyStatus(
  text: string,
): { status?: unknown; service?: unknown } | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object"
      ? (parsed as { status?: unknown; service?: unknown })
      : null;
  } catch {
    return null;
  }
}
/**
 * Liveness for one application origin.
 *
 * `/healthz` is the contract, but it is not a load-bearing one: a deploy that has
 * not landed yet, or a catch-all route shadowing the handler, leaves a perfectly
 * healthy app answering the wrong thing there. `combineHealth` ranks `unknown`
 * above `operational` on purpose — a stale observation must never be masked by a
 * fresh one — so a probe that cannot tell must not guess `unknown`, or one missing
 * route turns a service with five passing signals into "No data". When the health
 * route says nothing useful we fall back to the application root, which at least
 * distinguishes "serving traffic" from "not answering at all".
 */
export async function probeApp(
  id: string,
  origin: string,
  fetcher: Fetcher = (input, init) => fetch(input, init),
): Promise<ProbeResult> {
  const start = performance.now();
  const since = () => performance.now() - start;
  const request = (path: string) =>
    fetcher(new URL(path, origin), {
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  const fallback = async (reason: string): Promise<ProbeResult> => {
    let response: Awaited<ReturnType<Fetcher>>;
    try {
      response = await request("/");
    } catch (error) {
      return {
        status: "down",
        detail: `${reason}; the application root did not respond (${errorMessage(error)})`,
        latencyMs: since(),
      };
    }
    if (response.status >= 500)
      return {
        status: "down",
        detail: `${reason}; the application root returned HTTP ${response.status}`,
        latencyMs: since(),
      };
    if (AMBIGUOUS.has(response.status))
      return {
        status: "unknown",
        detail: `${reason}; the application root is gated (HTTP ${response.status})`,
        latencyMs: since(),
      };
    if (response.status >= 400)
      return {
        status: "degraded",
        detail: `${reason}; the application root returned HTTP ${response.status}`,
        latencyMs: since(),
      };
    return {
      status: "operational",
      detail: `${reason}; the application root is reachable`,
      latencyMs: since(),
    };
  };

  let response: Awaited<ReturnType<Fetcher>>;
  try {
    response = await request("/healthz");
  } catch (error) {
    return fallback(`Health check failed (${errorMessage(error)})`);
  }
  if (response.status >= 500)
    return {
      status: "down",
      detail: `Health check returned HTTP ${response.status}`,
      latencyMs: since(),
    };
  if (AMBIGUOUS.has(response.status))
    return {
      status: "unknown",
      detail: `Health check is gated (HTTP ${response.status})`,
      latencyMs: since(),
    };
  if (response.status >= 300)
    return fallback(`Health check returned HTTP ${response.status}`);

  const body = bodyStatus(await response.text().catch(() => ""));
  const reported = typeof body?.status === "string" ? body.status : null;
  if (!reported)
    return fallback("Health check did not return a recognised health response");
  const status = fromCheck(reported);
  if (status === "unknown")
    return fallback(
      `Health check reported an unrecognised state "${reported}"`,
    );
  const mismatch =
    typeof body?.service === "string" && body.service !== id
      ? `Health check identified itself as "${body.service}"`
      : null;
  return {
    status,
    detail:
      status === "operational" ? mismatch : `Health check reported ${reported}`,
    latencyMs: since(),
  };
}
