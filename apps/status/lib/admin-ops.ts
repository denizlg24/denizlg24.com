import { randomUUID } from "node:crypto";
import type {
  StatusIncidentCreateInput,
  StatusIncidentEscalateInput,
  StatusIncidentListQuery,
  StatusIncidentUpdateInput,
  StatusMaintenanceInput,
} from "@repo/schemas/status";
import { AccessError } from "./auth";
import { backupHealth, backupRunSummary } from "./backups";
import { betterRequest } from "./better-stack";
import { catalog, drJobs } from "./catalog";
import { resolveServices } from "./config";
import { collections, statusConfig } from "./db";
import { createIssue, ESCALATION_LABELS, githubConfig } from "./github";
import {
  freshStatus,
  maintenanceCovers,
  maintenanceOccurrence,
  overallHealth,
} from "./health";
import { describeEvidence, isProblem } from "./incidents";
import type { Incident, Maintenance, Service } from "./model";
import { fireRoutine, routineConfig, routineFireText } from "./routine";

/**
 * Every write the admin surface and the HTTP API share. The server actions in
 * `app/admin/actions.ts` and the routes under `app/api/admin` both call in
 * here with whoever they authenticated; nothing below reads a request.
 */
export type Actor = { id: string; username: string };

const stamp = () => new Date().toISOString();

// Only what the page actually shows can be named by an incident or a
// maintenance window; a hidden tile would announce impact nobody can see.
export async function visibleServices(): Promise<Service[]> {
  const c = await collections();
  const [snapshot, config] = await Promise.all([
    c.snapshots.findOne({ _id: "latest" }),
    statusConfig(),
  ]);
  return resolveServices(snapshot?.services ?? catalog, config);
}

async function validateServices(ids: string[]) {
  const services = await visibleServices();
  if (ids.some((id) => !services.some((service) => service.id === id)))
    throw new AccessError(
      400,
      "Select services from the latest monitoring report.",
    );
}

export async function audited<T>(
  actor: Actor,
  action: string,
  target: string,
  operation: () => Promise<T>,
  auditId = `${actor.id}:${randomUUID()}`,
): Promise<T> {
  const c = await collections();
  await c.audit.insertOne({
    _id: auditId,
    at: new Date(),
    actor: actor.username,
    action,
    target,
    outcome: "started",
  });
  try {
    const result = await operation();
    await c.audit.updateOne(
      { _id: auditId },
      { $set: { outcome: "completed" } },
    );
    return result;
  } catch (error) {
    await c.audit.updateOne(
      { _id: auditId },
      {
        $set: {
          outcome: `failed: ${error instanceof Error ? error.message.slice(0, 300) : "unknown"}`,
        },
      },
    );
    throw error;
  }
}

async function loadIncident(id: string): Promise<Incident> {
  const c = await collections();
  const incident = await c.incidents.findOne({ _id: id });
  if (!incident) throw new AccessError(404, "Incident not found.");
  return incident;
}

export async function createIncident(
  actor: Actor,
  input: StatusIncidentCreateInput,
): Promise<Incident> {
  await validateServices(input.serviceIds);
  const c = await collections();
  const now = stamp();
  const incident: Incident = {
    _id: `manual:${randomUUID()}`,
    betterStackId: null,
    title: input.title,
    serviceIds: input.serviceIds,
    startedAt: now,
    acknowledgedAt: now,
    recoveredAt: null,
    resolvedAt: null,
    cause: "Manually reported",
    evidence: [],
    updates: [
      {
        id: randomUUID(),
        at: now,
        author: actor.username,
        visibility: "public",
        state: "investigating",
        text: input.text,
      },
    ],
    agentRunId: null,
    agentVerdict: null,
    issueUrl: null,
  };
  await c.incidents.insertOne(incident);
  return incident;
}

export async function postIncidentUpdate(
  actor: Actor,
  id: string,
  input: StatusIncidentUpdateInput,
): Promise<Incident> {
  const incident = await loadIncident(id);
  if (input.state === "resolved" && !incident.resolvedAt)
    throw new AccessError(
      400,
      "Resolve the incident before posting a resolved update.",
    );
  if (incident.betterStackId)
    await betterRequest(
      `/api/v2/incidents/${encodeURIComponent(incident.betterStackId)}/comments`,
      {
        method: "POST",
        body: JSON.stringify({
          content: `[${input.visibility} status-page note · ${input.state}] ${input.text}\n\nBy ${actor.username}`,
        }),
      },
    );
  const c = await collections();
  const now = stamp();
  await c.incidents.updateOne(
    { _id: incident._id },
    {
      $push: {
        updates: {
          id: randomUUID(),
          at: now,
          author: actor.username,
          visibility: input.visibility,
          state: input.state,
          text: input.text,
        },
      },
      ...(input.verdict ? { $set: { agentVerdict: input.verdict } } : {}),
    },
  );
  return loadIncident(id);
}

export async function settleIncident(
  actor: Actor,
  id: string,
  outcome: "acknowledge" | "resolve",
): Promise<Incident> {
  const incident = await loadIncident(id);
  const resolve = outcome === "resolve";
  if (incident.betterStackId)
    await betterRequest(
      `/api/v3/incidents/${encodeURIComponent(incident.betterStackId)}/${outcome}`,
      {
        method: "POST",
        body: JSON.stringify(
          resolve
            ? { resolved_by: actor.username }
            : { acknowledged_by: actor.username },
        ),
      },
    );
  const c = await collections();
  const now = stamp();
  await c.incidents.updateOne(
    { _id: incident._id },
    { $set: resolve ? { resolvedAt: now } : { acknowledgedAt: now } },
  );
  return loadIncident(id);
}

export function escalationConfigured(): boolean {
  return githubConfig() !== null;
}

/**
 * One issue per incident, ever: a second escalation returns the first one.
 * The issue body is the agent's diagnosis; the incident's own evidence is
 * appended so the repository agent starts from the same facts.
 */
export async function escalateIncident(
  actor: Actor,
  id: string,
  input: StatusIncidentEscalateInput,
): Promise<{ incident: Incident; issueUrl: string; created: boolean }> {
  const incident = await loadIncident(id);
  if (incident.issueUrl)
    return { incident, issueUrl: incident.issueUrl, created: false };
  const services = await visibleServices();
  const names = incident.serviceIds.map(
    (serviceId) =>
      services.find((service) => service.id === serviceId)?.name ?? serviceId,
  );
  const evidence = describeEvidence(incident.evidence);
  const labels = Array.from(new Set([...ESCALATION_LABELS, ...input.labels]));
  const issue = await createIssue({
    title: input.title ?? `Incident: ${incident.title}`,
    body: [
      input.body,
      "",
      "---",
      `Status page incident \`${incident._id}\` · started ${incident.startedAt}`,
      `Services: ${names.join(", ")}`,
      evidence.length
        ? [
            "",
            "Evidence at open:",
            ...evidence.map((line) => `- ${line}`),
          ].join("\n")
        : "",
      `Escalated by ${actor.username}.`,
    ].join("\n"),
    labels,
  });
  const c = await collections();
  const now = stamp();
  await c.incidents.updateOne(
    { _id: incident._id },
    {
      $set: { issueUrl: issue.url, agentVerdict: "code" },
      $push: {
        updates: {
          id: randomUUID(),
          at: now,
          author: actor.username,
          visibility: "private",
          state: "identified",
          text: `Escalated to ${issue.url}`,
        },
      },
    },
  );
  // The issue already exists and the daily sweep finds it, so a refused fire
  // is a note on the incident, never a failed escalation.
  if (labels.includes("agent-fix") && routineConfig()) {
    const text = await fireRoutine(routineFireText(issue.url, incident._id))
      .then((session) => `Repository agent started: ${session}`)
      .catch(
        (error: unknown) =>
          `Repository agent not started (${error instanceof Error ? error.message : "unknown error"}); the daily sweep will pick the issue up.`,
      );
    await c.incidents.updateOne(
      { _id: incident._id },
      {
        $push: {
          updates: {
            id: randomUUID(),
            at: stamp(),
            author: actor.username,
            visibility: "private",
            state: "identified",
            text,
          },
        },
      },
    );
  }
  return {
    incident: await loadIncident(id),
    issueUrl: issue.url,
    created: true,
  };
}

export async function saveMaintenance(
  actor: Actor,
  id: string | null,
  input: StatusMaintenanceInput,
): Promise<Maintenance> {
  await validateServices(input.serviceIds);
  const c = await collections();
  if (id && !(await c.maintenance.findOne({ _id: id })))
    throw new AccessError(404, "Maintenance window not found.");
  const _id = id || randomUUID();
  await c.maintenance.updateOne(
    { _id },
    { $set: { ...input, author: actor.username, cancelledAt: null } },
    { upsert: !id },
  );
  const stored = await c.maintenance.findOne({ _id });
  if (!stored) throw new AccessError(500, "Maintenance window was not saved.");
  return stored;
}

export async function cancelMaintenance(
  _actor: Actor,
  id: string,
): Promise<Maintenance> {
  const c = await collections();
  const result = await c.maintenance.findOneAndUpdate(
    { _id: id },
    { $set: { cancelledAt: stamp() } },
    { returnDocument: "after" },
  );
  if (!result) throw new AccessError(404, "Maintenance window not found.");
  return result;
}

/** Reads for the HTTP API. Shapes are what the tools pass through. */

export function incidentSummary(incident: Incident) {
  const last = incident.updates.at(-1);
  return {
    id: incident._id,
    title: incident.title,
    serviceIds: incident.serviceIds,
    origin: incident._id.startsWith("auto:")
      ? "auto"
      : incident._id.startsWith("manual:")
        ? "manual"
        : "betterstack",
    startedAt: incident.startedAt,
    acknowledgedAt: incident.acknowledgedAt,
    recoveredAt: incident.recoveredAt ?? null,
    resolvedAt: incident.resolvedAt,
    state: incident.resolvedAt ? "resolved" : (last?.state ?? "investigating"),
    cause: incident.cause,
    agentRunId: incident.agentRunId ?? null,
    agentVerdict: incident.agentVerdict ?? null,
    issueUrl: incident.issueUrl ?? null,
    updates: incident.updates.length,
  };
}

export function incidentDetail(incident: Incident) {
  return {
    ...incidentSummary(incident),
    betterStackId: incident.betterStackId,
    evidence: incident.evidence,
    updates: incident.updates,
  };
}

export async function listIncidents(query: StatusIncidentListQuery) {
  const c = await collections();
  const rows = await c.incidents
    .find(query.state === "open" ? { resolvedAt: null } : {})
    .sort({ startedAt: -1 })
    .limit(query.limit)
    .toArray();
  return { incidents: rows.map(incidentSummary) };
}

export async function getIncident(id: string) {
  return { incident: incidentDetail(await loadIncident(id)) };
}

export function maintenanceView(window: Maintenance, now: number) {
  return {
    id: window._id,
    title: window.title,
    description: window.description,
    serviceIds: window.serviceIds,
    startsAt: window.startsAt,
    endsAt: window.endsAt,
    repeat: window.repeat ?? null,
    cancelledAt: window.cancelledAt,
    active: !window.cancelledAt && maintenanceCovers(window, now),
    next: window.cancelledAt ? null : maintenanceOccurrence(window, now),
  };
}

export async function listMaintenance(now = Date.now()) {
  const c = await collections();
  const rows = await c.maintenance
    .find({
      cancelledAt: null,
      $or: [
        { repeat: "weekly" },
        { endsAt: { $gte: new Date(now - 30 * 86400_000).toISOString() } },
      ],
    })
    .sort({ startsAt: 1 })
    .limit(100)
    .toArray();
  return { maintenance: rows.map((row) => maintenanceView(row, now)) };
}

export async function overview(now = Date.now()) {
  const c = await collections();
  const [snapshot, config, incidents, maintenance] = await Promise.all([
    c.snapshots.findOne({ _id: "latest" }),
    statusConfig(),
    c.incidents.find({ resolvedAt: null }).sort({ startedAt: -1 }).toArray(),
    c.maintenance.find({ cancelledAt: null }).toArray(),
  ]);
  const active = maintenance.filter((window) => maintenanceCovers(window, now));
  const services = resolveServices(snapshot?.services ?? catalog, config).map(
    (service) => {
      const status = active.some((window) =>
        window.serviceIds.includes(service.id),
      )
        ? "maintenance"
        : freshStatus(service.status, service.checkedAt, now);
      return {
        id: service.id,
        name: service.name,
        group: service.group,
        status,
        observed: service.observed ?? null,
        since: service.since ?? null,
        checkedAt: service.checkedAt,
        latencyMs: service.latencyMs,
        problems: describeEvidence(service.evidence),
        evidenceCount: service.evidence.length,
      };
    },
  );
  return {
    at: snapshot?.at ?? null,
    status: overallHealth(services.map((service) => service.status)),
    services,
    warnings: snapshot?.warnings ?? [],
    incidents: incidents.map(incidentSummary),
    maintenance: active.map((window) => maintenanceView(window, now)),
    escalation: escalationConfigured() ? "configured" : "unconfigured",
  };
}

export async function serviceSamples(serviceId: string, minutes: number) {
  const c = await collections();
  const since = new Date(Date.now() - minutes * 60_000);
  const rows = await c.samples
    .find({ serviceId, at: { $gte: since } })
    .sort({ at: -1 })
    .limit(minutes)
    .toArray();
  return {
    serviceId,
    since: since.toISOString(),
    samples: rows.map((row) => ({
      at: row.at.toISOString(),
      status: row.status,
      observed: row.observed ?? row.status,
      latencyMs: row.latencyMs,
      problems: row.evidence.filter(isProblem).map((item) => ({
        source: item.source,
        status: item.status,
        detail: item.detail,
      })),
    })),
  };
}

export async function backupsOverview(now = Date.now()) {
  const c = await collections();
  const rows = await c.backups.find({}).toArray();
  const backups = rows.map((backup) => ({
    id: backup.id,
    name: drJobs.find((job) => job.id === backup.id)?.name ?? backup.name,
    provider: backup.provider,
    status: backup.status,
    health: backupHealth(backup, now),
    enabled: backup.enabled,
    schedule: backup.schedule,
    reportedAt: backup.reportedAt,
    lastSuccessAt: backup.lastSuccessAt,
    nextRunAt: backup.nextRunAt,
    durationMs: backup.durationMs,
    sizeBytes: backup.sizeBytes,
    runSummary: backupRunSummary(backup),
    detail: backup.detail?.slice(-1500) ?? null,
  }));
  return { backups };
}
