import type { Daily, DayHealth, Evidence, Health, Service } from "./model";
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
/** Consecutive `down` observations before a service is confirmed down. */
export const DOWN_CONFIRM_OBSERVATIONS = 3;
/** Consecutive `operational` observations before a confirmed down or degraded service recovers. */
export const RECOVER_OBSERVATIONS = 2;
/** Consecutive `unknown` observations a confirmed status survives before it is reported as such. */
export const UNKNOWN_HOLD_OBSERVATIONS = 10;
/** Minutes every service must stay operational before an automatic incident resolves. */
export const AUTO_RESOLVE_MINUTES = 5;
/** Sample window the streaks are read from; older observations never count. */
export const STREAK_WINDOW_MS = 15 * 60_000;
function leading(recent: Health[], state: Health): number {
  let count = 0;
  for (const item of recent) {
    if (item !== state) break;
    count += 1;
  }
  return count;
}
/**
 * The status the page shows, derived from this minute's observation and the
 * ones before it. One failed observation is a degradation, not an outage:
 * `down` takes `DOWN_CONFIRM_OBSERVATIONS` in a row, and leaving `down` or
 * `degraded` takes `RECOVER_OBSERVATIONS` clean ones, so a probe that flaps
 * neither paints an outage nor clears one. `unknown` holds the last confirmed
 * status for a while — a stale collector is not a recovery and not an outage.
 * `maintenance` is applied outside this function and wins over all of it.
 *
 * `recent` is the observed status of the preceding samples, newest first,
 * excluding the current one.
 */
export function confirmStatus(
  observed: Health,
  previous: Health,
  recent: Health[],
): Health {
  const streak = 1 + leading(recent, observed);
  switch (observed) {
    case "maintenance":
      return "maintenance";
    case "down":
      if (streak >= DOWN_CONFIRM_OBSERVATIONS || previous === "down")
        return "down";
      return "degraded";
    case "degraded":
      return "degraded";
    case "operational":
      if (previous !== "down" && previous !== "degraded") return "operational";
      return streak >= RECOVER_OBSERVATIONS ? "operational" : previous;
    case "unknown":
      if (previous === "unknown" || previous === "maintenance")
        return "unknown";
      return streak > UNKNOWN_HOLD_OBSERVATIONS ? "unknown" : previous;
  }
}
const WEEK_MS = 7 * 86400_000;
/**
 * Whether a window covers `now`. A weekly window is the same weekday and time
 * every week from `startsAt` on; the reboot that happens every Sunday is one
 * row, not fifty-two.
 */
export function maintenanceCovers(
  window: { startsAt: string; endsAt: string; repeat?: "weekly" | null },
  now: number,
): boolean {
  const starts = Date.parse(window.startsAt);
  const ends = Date.parse(window.endsAt);
  if (!Number.isFinite(starts) || !Number.isFinite(ends) || ends <= starts)
    return false;
  if (window.repeat !== "weekly") return starts <= now && ends > now;
  if (now < starts) return false;
  const offset = (now - starts) % WEEK_MS;
  return offset < ends - starts;
}
/** The next occurrence's bounds, for display; the row's own dates for one-off windows. */
export function maintenanceOccurrence(
  window: { startsAt: string; endsAt: string; repeat?: "weekly" | null },
  now: number,
): { startsAt: string; endsAt: string } {
  const starts = Date.parse(window.startsAt);
  const ends = Date.parse(window.endsAt);
  if (window.repeat !== "weekly" || now < starts || ends <= starts)
    return { startsAt: window.startsAt, endsAt: window.endsAt };
  const weeks = Math.floor((now - starts) / WEEK_MS);
  const current = starts + weeks * WEEK_MS;
  const shift = current + (ends - starts) > now ? current : current + WEEK_MS;
  return {
    startsAt: new Date(shift).toISOString(),
    endsAt: new Date(shift + (ends - starts)).toISOString(),
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
export const dayHealthLabels: Record<DayHealth, string> = {
  operational: "Operational",
  degraded: "Degraded",
  partial: "Partial outage",
  down: "Major outage",
  unknown: "No data",
};
export const PARTIAL_OUTAGE_MINUTES = 15;
export const MAJOR_OUTAGE_MINUTES = 120;
/**
 * A day is coloured by how much of it was lost, not by whether anything was.
 * Nobody declares incidents here — every sample is a monitor's verdict — so a
 * single dropped minute painting the whole day red made the bar read as a run
 * of outages. One minute counts per service, so `down` is minutes; a blip
 * shorter than a coffee ranks with a slowdown, and only hours earn red.
 */
export function dailyHealth(day?: Daily): DayHealth {
  if (!day || !(day.operational + day.degraded + day.down)) return "unknown";
  if (day.down >= MAJOR_OUTAGE_MINUTES) return "down";
  if (day.down >= PARTIAL_OUTAGE_MINUTES) return "partial";
  if (day.down || day.degraded) return "degraded";
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
