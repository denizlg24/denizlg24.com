import { randomUUID } from "node:crypto";
import { AUTO_RESOLVE_MINUTES } from "./health";
import type { Evidence, Health, Incident, Service, Update } from "./model";

export const AUTO_PREFIX = "auto:";
export const isAutoIncident = (incident: Pick<Incident, "_id">) =>
  incident._id.startsWith(AUTO_PREFIX);

/**
 * Which services fail together. A superset of the collector's evidence
 * dependencies: those decide what a dependent *shows*, these decide what one
 * incident *covers*, and the deep transaction is worth grouping with the
 * stores it exercises even though its own evidence already names them.
 */
export const incidentRelations: Record<string, string[]> = {
  api: ["postgres", "mongodb", "redis"],
  "deep-health": [
    "api",
    "postgres",
    "mongodb",
    "redis",
    "posix",
    "objectStorage",
    "storageProtocol",
    "search",
  ],
  cloud: ["api", "postgres", "mongodb", "redis"],
  forge: ["api", "deploy-agent"],
  storage: ["api", "posix", "objectStorage", "storageProtocol", "search"],
};

function related(a: string, b: string): boolean {
  return (
    a === b ||
    (incidentRelations[a]?.includes(b) ?? false) ||
    (incidentRelations[b]?.includes(a) ?? false)
  );
}

export type IncidentPlan = {
  open: { services: Service[] }[];
  merge: { incidentId: string; service: Service }[];
  recover: string[];
  regress: { incidentId: string; service: Service }[];
  resolve: string[];
};

/**
 * What the collector should do to the incident list given this run's
 * confirmed statuses. Pure: the caller applies it.
 *
 * Only a confirmed `down` opens anything, and a service already named by any
 * open incident — automatic, manual or mirrored — never opens a second one. A
 * newly failing service joins an open automatic incident it is related to,
 * so a store going down takes its dependents into the same incident rather
 * than four. Only automatic incidents recover and resolve on their own; a
 * manual one is the owner's narrative and stays until they close it.
 */
export function planIncidents(input: {
  services: Service[];
  open: Incident[];
  now: number;
}): IncidentPlan {
  const { services, open, now } = input;
  const plan: IncidentPlan = {
    open: [],
    merge: [],
    recover: [],
    regress: [],
    resolve: [],
  };
  const covered = new Set(open.flatMap((incident) => incident.serviceIds));
  const openAuto = open.filter(isAutoIncident).map((incident) => ({
    id: incident._id,
    serviceIds: [...incident.serviceIds],
  }));
  const pending: { services: Service[] }[] = [];
  for (const service of services) {
    if (service.status !== "down" || covered.has(service.id)) continue;
    covered.add(service.id);
    const existing = openAuto.find((incident) =>
      incident.serviceIds.some((id) => related(id, service.id)),
    );
    if (existing) {
      existing.serviceIds.push(service.id);
      plan.merge.push({ incidentId: existing.id, service });
      continue;
    }
    const group = pending.find((entry) =>
      entry.services.some((member) => related(member.id, service.id)),
    );
    if (group) group.services.push(service);
    else pending.push({ services: [service] });
  }
  plan.open = pending;

  const byId = new Map(services.map((service) => [service.id, service]));
  for (const incident of open.filter(isAutoIncident)) {
    const members = incident.serviceIds.map((id) => byId.get(id));
    const failing = members.find(
      (service) => service?.status !== "operational",
    );
    if (!failing) {
      if (!incident.recoveredAt) plan.recover.push(incident._id);
      else if (
        now - Date.parse(incident.recoveredAt) >=
        AUTO_RESOLVE_MINUTES * 60_000
      )
        plan.resolve.push(incident._id);
      continue;
    }
    if (incident.recoveredAt && failing)
      plan.regress.push({ incidentId: incident._id, service: failing });
  }
  return plan;
}

export const isProblem = (item: Evidence) => item.status !== "operational";

/** Lines the owner and the triage agent read first; never shown publicly as-is. */
export function describeEvidence(evidence: Evidence[]): string[] {
  return evidence
    .filter(isProblem)
    .map(
      (item) =>
        `${item.source}: ${item.status}${item.detail ? ` — ${item.detail}` : ""}`,
    );
}

export function incidentCause(services: Service[]): string {
  const lines = services.flatMap((service) =>
    describeEvidence(service.evidence).map(
      (line) => `${service.name} · ${line}`,
    ),
  );
  return lines.slice(0, 6).join("\n") || "Monitoring confirmed an outage.";
}

const SYSTEM_AUTHOR = "monitoring";

export function systemUpdate(
  state: Update["state"],
  visibility: Update["visibility"],
  text: string,
  at: string,
): Update {
  return {
    id: randomUUID(),
    at,
    author: SYSTEM_AUTHOR,
    visibility,
    state,
    text,
  };
}

export function newAutoIncident(services: Service[], at: string): Incident {
  const [first] = services;
  const names = services.map((service) => service.name);
  const cause = incidentCause(services);
  return {
    _id: `${AUTO_PREFIX}${randomUUID()}`,
    betterStackId: null,
    title: `${names.length === 1 ? (first?.name ?? "Service") : names.join(", ")} interruption`,
    serviceIds: services.map((service) => service.id),
    startedAt: at,
    acknowledgedAt: null,
    recoveredAt: null,
    resolvedAt: null,
    cause,
    evidence: services.flatMap((service) => service.evidence.filter(isProblem)),
    updates: [
      systemUpdate(
        "investigating",
        "private",
        `Confirmed down after repeated failed observations.\n${cause}`,
        at,
      ),
    ],
    agentRunId: null,
    agentVerdict: null,
    issueUrl: null,
  };
}

export function statusWord(status: Health): string {
  return status === "down"
    ? "unavailable"
    : status === "degraded"
      ? "degraded"
      : status === "maintenance"
        ? "in maintenance"
        : status === "unknown"
          ? "not reporting"
          : "operational";
}
