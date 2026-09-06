import type { Daily, Evidence, Health, Service } from "./model";
export const FRESHNESS_MS = 180_000;
export const healthLabels: Record<Health, string> = {
  operational: "Operational",
  degraded: "Degraded",
  down: "Outage",
  unknown: "No data",
  maintenance: "Maintenance",
};
export function combineHealth(states: Health[]): Health {
  if (!states.length) return "unknown";
  for (const state of ["down", "degraded", "unknown", "maintenance"] as const) {
    if (states.includes(state)) return state;
  }
  return "operational";
}
/**
 * The page-wide banner, which is deliberately not `combineHealth`.
 *
 * Within one service, an unknown observation must outrank an operational one —
 * a stale signal cannot be masked by a fresh one. Across services that rule is
 * wrong: it lets two never-pinged heartbeats report "No recent data" over
 * eighteen services that are demonstrably up. Here an unknown service only
 * decides the headline when nothing is actually known, and is otherwise counted
 * next to the headline rather than allowed to replace it.
 */
export function overallHealth(states: Health[]): Health {
  if (!states.length) return "unknown";
  for (const state of ["down", "degraded", "maintenance"] as const)
    if (states.includes(state)) return state;
  return states.includes("operational") ? "operational" : "unknown";
}
export function freshStatus(
  status: Health,
  at: string | null,
  now: number,
): Health {
  if (
    !at ||
    !Number.isFinite(Date.parse(at)) ||
    now - Date.parse(at) > FRESHNESS_MS ||
    Date.parse(at) > now + 30_000
  )
    return "unknown";
  return status;
}
export function fromCheck(value: string): Health {
  return (
    (
      {
        ok: "operational",
        up: "operational",
        operational: "operational",
        down: "down",
        unavailable: "down",
        degraded: "degraded",
        paused: "unknown",
        maintenance: "maintenance",
      } as Record<string, Health>
    )[value] ?? "unknown"
  );
}
export function summarizeService(
  service: Service,
  evidence: Evidence[],
  now: number,
): Service {
  const states = evidence.map((item) => freshStatus(item.status, item.at, now));
  const latency =
    evidence.find((item) => item.latencyMs !== null)?.latencyMs ?? null;
  return {
    ...service,
    status: combineHealth(states),
    checkedAt: evidence.length ? new Date(now).toISOString() : null,
    latencyMs: latency,
    evidence,
  };
}
export function availability(days: Daily[]): {
  percent: number | null;
  measured: number;
} {
  const counts = days.reduce(
    (sum, d) => ({
      up: sum.up + d.operational,
      known: sum.known + d.operational + d.degraded + d.down,
    }),
    { up: 0, known: 0 },
  );
  return {
    percent: counts.known ? (counts.up / counts.known) * 100 : null,
    measured: counts.known,
  };
}
export function dailyHealth(day?: Daily): Health {
  if (!day || !(day.operational + day.degraded + day.down)) return "unknown";
  if (day.down) return "down";
  if (day.degraded) return "degraded";
  return "operational";
}
export function fallbackExplanation(cause: string): string {
  if (/timeout|timed out/i.test(cause))
    return "The service did not respond within the check timeout. The underlying cause is under investigation.";
  if (/certificate|tls|ssl/i.test(cause))
    return "A secure connection check failed. The certificate and connection are being investigated.";
  if (/dns|resolve|lookup/i.test(cause))
    return "A network name lookup failed. Connectivity is being investigated.";
  if (/\b[45]\d\d\b/.test(cause))
    return "The service returned an unsuccessful response. The underlying cause is under investigation.";
  return "A monitoring check detected an interruption. More information will be posted when the cause is confirmed.";
}
