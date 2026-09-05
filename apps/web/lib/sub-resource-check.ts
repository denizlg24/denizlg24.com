import net from "node:net";
import type {
  ISubResourceHttpCheck,
  ISubResourceTcpCheck,
  SubResourceCheck,
} from "@/models/resource-db/SubResource";
import { healthCheckHeaders } from "./health-check-credential";

const CHECK_TIMEOUT_MS = 10_000;

export interface SubResourceCheckResult {
  isHealthy: boolean;
  status: number | null;
  responseTimeMs: number;
  error?: string;
}

function readJsonPath(body: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc != null && typeof acc === "object" && key in acc) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, body);
}

async function runHttpCheck(
  check: ISubResourceHttpCheck,
  responses?: Map<string, Promise<Response>>,
): Promise<SubResourceCheckResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(
    () => controller.abort(),
    CHECK_TIMEOUT_MS,
  );

  try {
    const key = JSON.stringify([check.url, check.credentialId ?? null]);
    let pending = responses?.get(key);
    if (!pending) {
      const headers = await healthCheckHeaders(check.url, check.credentialId);
      pending = fetch(check.url, {
        signal: controller.signal,
        cache: "no-store",
        // Never forward a credential to a redirect destination.
        ...(check.credentialId ? { redirect: "error" as const } : {}),
        headers: { "User-Agent": "denizlg24-status-check/1.0", ...headers },
      });
      responses?.set(key, pending);
    }
    const res = (await pending).clone();
    const responseTimeMs = Date.now() - startedAt;

    const statusOk =
      check.expectStatus != null ? res.status === check.expectStatus : res.ok;
    // Deep health returns 503 when any dependency fails. A component row
    // must still evaluate its own result, so one failed search probe does not
    // falsely mark PostgreSQL and MongoDB down too.
    const componentResult =
      check.credentialId === "dr-synthetic" &&
      /^checks\.[A-Za-z]+\.status$/.test(check.expectJsonPath ?? "") &&
      res.status === 503;
    if (!statusOk && !componentResult) {
      return {
        isHealthy: false,
        status: res.status,
        responseTimeMs,
        error: `Unexpected HTTP status ${res.status}`,
      };
    }

    if (check.expectJsonPath && check.expectEquals != null) {
      const body = (await res.json().catch(() => null)) as unknown;
      const value =
        body != null ? readJsonPath(body, check.expectJsonPath) : undefined;
      if (String(value) !== check.expectEquals) {
        return {
          isHealthy: false,
          status: res.status,
          responseTimeMs: Date.now() - startedAt,
          error: `Expected ${check.expectJsonPath}=${check.expectEquals}, got ${String(value)}`,
        };
      }
    }

    return { isHealthy: true, status: res.status, responseTimeMs };
  } catch (err) {
    return {
      isHealthy: false,
      status: null,
      responseTimeMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function runTcpCheck(
  check: ISubResourceTcpCheck,
): Promise<SubResourceCheckResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let settled = false;

    const socket = net.connect({ host: check.host, port: check.port });
    socket.setTimeout(CHECK_TIMEOUT_MS);

    const finish = (isHealthy: boolean, error?: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({
        isHealthy,
        status: null,
        responseTimeMs: Date.now() - startedAt,
        ...(error ? { error } : {}),
      });
    };

    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false, "Connection timed out"));
    socket.once("error", (err) => finish(false, err.message));
  });
}

export function runSubResourceCheck(
  check: SubResourceCheck,
  responses?: Map<string, Promise<Response>>,
): Promise<SubResourceCheckResult> {
  if (check.type === "http") return runHttpCheck(check, responses);
  return runTcpCheck(check);
}
