import { cacheLife, cacheTag } from "next/cache";
import { backupHealth, backupRunSummary } from "./backups";
import { catalog, drJobs } from "./catalog";
import {
  emptyConfig,
  orderedGroups,
  resolveServices,
  type StatusConfig,
} from "./config";
import { collections } from "./db";
import { fallbackExplanation, freshStatus, overallHealth } from "./health";
import type { Incident } from "./model";

export { backupHealth } from "./backups";

export function publicIncident(incident: Incident) {
  const updates = incident.updates
    .filter((update) => update.visibility === "public")
    .map(({ id, at, state, text }) => ({ id, at, state, text }));
  return {
    id: incident._id,
    title: incident.title,
    serviceIds: incident.serviceIds,
    startedAt: incident.startedAt,
    resolvedAt: incident.resolvedAt,
    updates,
    explanation: updates.at(-1)?.text ?? fallbackExplanation(incident.cause),
  };
}

export async function publicData() {
  "use cache";
  cacheLife({ stale: 30, revalidate: 30, expire: 60 });
  cacheTag("status-public");
  const now = Date.now();
  const since = new Date(now - 90 * 86400_000);
  let available = true;
  const result = await (async () => {
    if (!process.env.STATUS_MONGODB_URI) return null;
    const c = await collections();
    const [snapshot, config, daily, backups, incidents, maintenance] =
      await Promise.all([
        c.snapshots.findOne({ _id: "latest" }),
        c.config.findOne({ _id: "config" }),
        c.daily
          .find(
            { day: { $gte: since.toISOString().slice(0, 10) } },
            { projection: { _id: 0, expiresAt: 0 } },
          )
          .toArray(),
        c.backups.find({}).toArray(),
        c.incidents
          .find({
            $or: [
              { startedAt: { $gte: since.toISOString() } },
              { resolvedAt: null },
            ],
          })
          .sort({ startedAt: -1 })
          .limit(200)
          .toArray(),
        c.maintenance
          .find({ endsAt: { $gte: since.toISOString() }, cancelledAt: null })
          .sort({ startsAt: 1 })
          .limit(100)
          .toArray(),
      ]);
    return { snapshot, config, daily, backups, incidents, maintenance };
  })().catch(() => {
    available = false;
    return null;
  });
  const maintenance = (result?.maintenance ?? []).map(
    ({ _id, title, description, serviceIds, startsAt, endsAt }) => ({
      id: _id,
      title,
      description,
      serviceIds,
      startsAt,
      endsAt,
    }),
  );
  const currentMaintenance = maintenance.filter(
    (item) => Date.parse(item.startsAt) <= now && Date.parse(item.endsAt) > now,
  );
  const config: StatusConfig = { ...emptyConfig, ...(result?.config ?? {}) };
  const services = resolveServices(
    result?.snapshot?.services ?? catalog,
    config,
  ).map(({ evidence, ...service }) => {
    let status = freshStatus(service.status, service.checkedAt, now);
    if (
      (result?.incidents ?? []).some(
        (incident) =>
          !incident.resolvedAt && incident.serviceIds.includes(service.id),
      )
    )
      status = "down";
    if (currentMaintenance.some((item) => item.serviceIds.includes(service.id)))
      status = "maintenance";
    return { ...service, status };
  });
  const backups = (result?.backups ?? []).map((backup) => ({
    id: backup.id,
    name: drJobs.find((job) => job.id === backup.id)?.name ?? backup.name,
    provider: backup.provider,
    status: backup.status,
    health: backupHealth(backup, now),
    enabled: backup.enabled,
    reportedAt: backup.reportedAt,
    startedAt: backup.startedAt,
    completedAt: backup.completedAt,
    lastSuccessAt: backup.lastSuccessAt,
    nextRunAt: backup.nextRunAt,
    durationMs:
      backup.durationMs ??
      (backup.status === "running" && backup.startedAt
        ? Math.max(0, now - Date.parse(backup.startedAt))
        : null),
    runSummary: backupRunSummary(backup),
  }));
  for (const job of drJobs)
    if (!backups.some((backup) => backup.id === job.id))
      backups.push({
        id: job.id,
        name: job.name,
        provider: "dr",
        status: "unknown",
        health: "unknown",
        enabled: true,
        reportedAt: "",
        startedAt: null,
        completedAt: null,
        lastSuccessAt: null,
        nextRunAt: null,
        durationMs: null,
        runSummary: null,
      });
  return {
    at: result?.snapshot?.at ?? null,
    generatedAt: new Date(now).toISOString(),
    available: available && !!result?.snapshot,
    status: overallHealth(services.map((service) => service.status)),
    services,
    groups: orderedGroups(config).filter((group) =>
      services.some((service) => service.group === group),
    ),
    daily: result?.daily ?? [],
    backups,
    incidents: (result?.incidents ?? []).map(publicIncident),
    maintenance,
  };
}
export type PublicData = Awaited<ReturnType<typeof publicData>>;
export type PublicIncident = ReturnType<typeof publicIncident>;
export const formatDuration = (value: number | null) =>
  value === null
    ? "—"
    : value < 1000
      ? `${Math.round(value)} ms`
      : value < 60_000
        ? `${(value / 1000).toFixed(1)} s`
        : `${Math.floor(value / 60_000)}m ${Math.round((value % 60_000) / 1000)}s`;
