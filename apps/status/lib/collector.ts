import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  type BetterResource,
  betterList,
  betterRequest,
  mapConcurrent,
  responseTimesSchema,
  textAttribute,
} from "./better-stack";
import { appOrigins, catalog } from "./catalog";
import { monitoringSchema } from "./contracts";
import { collections } from "./db";
import { fromCheck, summarizeService } from "./health";
import type { Backup, Evidence, Incident, Snapshot, Timing } from "./model";

const apiOrigin = () =>
  process.env.STATUS_CLOUD_API_URL ?? "https://api.denizlg24.com";
const stamp = () => new Date().toISOString();
const numericId = (id: string) => /^\d+$/.test(id);
function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message.slice(0, 500)
    : "Collection failed";
}
function monitorService(
  monitor: BetterResource,
  mapping: Record<string, string>,
): string {
  if (mapping[monitor.id]) return mapping[monitor.id]!;
  const raw = textAttribute(monitor, "url");
  if (raw) {
    try {
      const url = new URL(raw);
      if (url.hostname === "api.denizlg24.com")
        return url.pathname === "/healthz/deep" ? "deep-health" : "api";
      const app = Object.entries(appOrigins).find(
        ([, origin]) => origin === url.origin,
      );
      if (app) return app[0];
    } catch {
      /* Non-HTTP monitors get their own service. */
    }
  }
  return `monitor:${monitor.id}`;
}

export async function collectStatus() {
  const c = await collections();
  const owner = randomUUID();
  try {
    const lease = await c.leases.findOneAndUpdate(
      { _id: "collector", until: { $lte: new Date() } },
      { $set: { owner, until: new Date(Date.now() + 150_000) } },
      { upsert: true, returnDocument: "after" },
    );
    if (!lease) return { skipped: true };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === 11000
    )
      return { skipped: true };
    throw error;
  }
  try {
    const previous = await c.snapshots.findOne({ _id: "latest" });
    const mapping = z
      .record(z.string(), z.string())
      .parse(JSON.parse(process.env.STATUS_MONITOR_MAP ?? "{}"));
    const warnings: string[] = [];
    const evidence = new Map<string, Evidence[]>();
    const services = new Map(catalog.map((service) => [service.id, service]));
    // Retain previously discovered services on a provider outage, as unknown.
    for (const service of previous?.services ?? [])
      if (!services.has(service.id))
        services.set(service.id, {
          ...service,
          evidence: [],
          status: "unknown",
        });
    const add = (id: string, item: Evidence) =>
      evidence.set(id, [...(evidence.get(id) ?? []), item]);
    const provider = async <T>(
      name: string,
      operation: () => Promise<T>,
    ): Promise<T | null> => {
      try {
        return await operation();
      } catch (error) {
        warnings.push(`${name}: ${errorMessage(error)}`);
        return null;
      }
    };
    const [monitoring, monitors, heartbeats, incidents] = await Promise.all([
      provider("Cloud observations", async () => {
        if (!process.env.STATUS_COLLECTOR_TOKEN)
          throw new Error("Collector token is not configured");
        const response = await fetch(new URL("/healthz/status", apiOrigin()), {
          headers: { "X-Status-Token": process.env.STATUS_COLLECTOR_TOKEN },
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return monitoringSchema.parse(await response.json());
      }),
      provider("Better Stack monitors", () =>
        betterList("/api/v2/monitors?per_page=50"),
      ),
      provider("Better Stack heartbeats", () =>
        betterList("/api/v2/heartbeats?per_page=50"),
      ),
      provider("Better Stack incidents", () =>
        betterList("/api/v3/incidents?per_page=50&resolved=false"),
      ),
      mapConcurrent(Object.entries(appOrigins), 4, async ([id, origin]) => {
        const start = performance.now();
        try {
          const response = await fetch(new URL("/healthz", origin), {
            cache: "no-store",
            redirect: "error",
            signal: AbortSignal.timeout(8_000),
          });
          const body = await response.json().catch(() => null);
          const verified = body?.status === "ok" && body?.service === id;
          add(id, {
            source: "Application runtime · Vercel probe",
            status:
              response.ok && verified
                ? "operational"
                : response.status >= 500
                  ? "down"
                  : "unknown",
            at: stamp(),
            latencyMs: performance.now() - start,
            detail: verified
              ? null
              : `HTTP ${response.status}; expected ${id} health response not received`,
          });
        } catch (error) {
          add(id, {
            source: "Application runtime · Vercel probe",
            status: "down",
            at: stamp(),
            latencyMs: performance.now() - start,
            detail: errorMessage(error),
          });
        }
      }),
    ]);
    if (monitoring?.deep)
      for (const [name, check] of Object.entries(monitoring.deep.checks)) {
        add("deep-health", {
          source: `Deep transaction · ${name}`,
          status: fromCheck(check.status),
          at: monitoring.deep.timestamp,
          latencyMs: check.latencyMs,
          detail: check.error ?? check.message ?? null,
        });
      }
    if (monitoring) {
      add("api", {
        source: "Authenticated API observation",
        status: "operational",
        at: monitoring.timestamp,
        latencyMs: null,
        detail: null,
      });
      for (const [label, data, expected] of [
        [
          "Deep transaction",
          monitoring.deep,
          [
            "postgres",
            "mongodb",
            "redis",
            "posix",
            "objectStorage",
            "storageProtocol",
            "search",
          ],
        ],
        [
          "Host health",
          monitoring.health,
          [
            "postgres",
            "mongodb",
            "redis",
            "meilisearch",
            "mongot",
            "disk",
            "tunnel",
            "forge",
          ],
        ],
      ] as const) {
        for (const name of expected) {
          const check = data?.checks[name];
          add(name === "forge" ? "deploy-agent" : name, {
            source: label,
            status: check ? fromCheck(check.status) : "unknown",
            at: data?.timestamp ?? stamp(),
            latencyMs: check?.latencyMs ?? null,
            detail:
              check?.error ??
              check?.message ??
              (check ? null : "Observation unavailable or timed out"),
          });
        }
      }
    } else {
      add("api", {
        source: "Authenticated API observation",
        status: "unknown",
        at: stamp(),
        latencyMs: null,
        detail: "Cloud observations are unavailable; see collector warnings",
      });
    }
    for (const [id, check] of Object.entries(monitoring?.extra?.checks ?? {})) {
      if (!services.has(id))
        services.set(id, {
          id,
          name: id
            .split("-")
            .map((word) => word[0]!.toUpperCase() + word.slice(1))
            .join(" "),
          group: "Infrastructure",
          description: "Service readiness checked from the Cloud host.",
          status: "unknown",
          checkedAt: null,
          latencyMs: null,
          evidence: [],
        });
      add(id, {
        source: "Service readiness",
        status: fromCheck(check.status),
        at: monitoring!.extra!.timestamp,
        latencyMs: check.latencyMs,
        detail: check.message ?? check.error ?? null,
      });
    }
    const monitorMap = new Map<string, string>();
    for (const monitor of monitors ?? []) {
      if (!numericId(monitor.id)) continue;
      const id = monitorService(monitor, mapping);
      monitorMap.set(monitor.id, id);
      if (!services.has(id))
        services.set(id, {
          id,
          name:
            textAttribute(monitor, "pronounceable_name") ??
            `Monitor ${monitor.id}`,
          group: "Other services",
          description: "External monitoring by Better Stack.",
          status: "unknown",
          checkedAt: null,
          latencyMs: null,
          evidence: [],
        });
      const state = textAttribute(monitor, "status") ?? "unknown";
      add(id, {
        source: `Better Stack monitor ${monitor.id}`,
        status: state === "validating" ? "degraded" : fromCheck(state),
        at:
          state === "maintenance"
            ? stamp()
            : (textAttribute(monitor, "last_checked_at") ?? ""),
        latencyMs: null,
        detail: `Monitor reports ${state}`,
      });
    }
    if (!monitors) {
      for (const service of previous?.services ?? [])
        for (const item of service.evidence) {
          if (item.source.startsWith("Better Stack monitor"))
            add(service.id, {
              ...item,
              status: "unknown",
              at: stamp(),
              detail: "Better Stack could not be refreshed",
            });
        }
    }
    for (const heartbeat of heartbeats ?? []) {
      const id = `heartbeat:${heartbeat.id}`;
      services.set(id, {
        id,
        name: textAttribute(heartbeat, "name") ?? `Heartbeat ${heartbeat.id}`,
        group: "Other services",
        description: "Scheduled heartbeat monitored by Better Stack.",
        status: "unknown",
        checkedAt: null,
        latencyMs: null,
        evidence: [],
      });
      add(id, {
        source: "Better Stack heartbeat",
        status: fromCheck(textAttribute(heartbeat, "status") ?? "unknown"),
        at: stamp(),
        latencyMs: null,
        detail: textAttribute(heartbeat, "last_ping_at")
          ? `Last ping: ${textAttribute(heartbeat, "last_ping_at")}`
          : "No ping timestamp available",
      });
    }
    // Active incidents are a separate signal; a passing probe cannot resolve them.
    for (const incident of incidents ?? []) {
      const monitorId = incident.relationships?.monitor?.data?.id;
      const heartbeatId = incident.relationships?.heartbeat?.data?.id;
      const id = monitorId
        ? monitorMap.get(monitorId)
        : heartbeatId
          ? `heartbeat:${heartbeatId}`
          : undefined;
      if (id)
        add(id, {
          source: `Better Stack incident ${incident.id}`,
          status: "down",
          at: stamp(),
          latencyMs: null,
          detail: textAttribute(incident, "cause"),
        });
    }
    const now = Date.now();
    let observed = Array.from(services.values()).map((service) =>
      summarizeService(service, evidence.get(service.id) ?? [], now),
    );
    const dependencies: Record<string, string[]> = {
      api: ["postgres", "mongodb", "redis"],
      cloud: ["api", "postgres", "mongodb", "redis"],
      forge: ["api", "deploy-agent"],
      storage: ["api", "posix", "objectStorage", "storageProtocol", "search"],
    };
    for (const [id, required] of Object.entries(dependencies)) {
      const service = observed.find((entry) => entry.id === id);
      if (!service) continue;
      const signals: Evidence[] = required.map((dependency) => {
        const result = observed.find((entry) => entry.id === dependency);
        return {
          source: `Dependency · ${result?.name ?? dependency}`,
          status:
            result?.status === "down"
              ? "degraded"
              : (result?.status ?? "unknown"),
          at: result?.checkedAt ?? stamp(),
          latencyMs: null,
          detail:
            result?.status === "down"
              ? "A required dependency is unavailable; application features may be affected."
              : null,
        };
      });
      observed = observed.map((entry) =>
        entry.id === id
          ? summarizeService(service, [...service.evidence, ...signals], now)
          : entry,
      );
    }
    const backups: Backup[] = [];
    if (monitoring?.backups) {
      for (const task of monitoring.backups.tasks) {
        const latest = monitoring.backups.runs.find(
          (run) => run.taskId === task.id,
        );
        const success = monitoring.backups.successes.find(
          (run) => run.taskId === task.id,
        );
        const backup: Backup = {
          id: task.id,
          name: task.name,
          provider: "cloud",
          status: latest?.status ?? "unknown",
          reportedAt: monitoring.timestamp,
          runId: latest?.id ?? null,
          startedAt: latest?.startedAt ?? null,
          completedAt: latest?.completedAt ?? null,
          lastSuccessAt: success?.completedAt ?? null,
          nextRunAt: task.nextRunAt,
          durationMs: latest?.metadata?.durationMs ?? null,
          sizeBytes: latest?.metadata?.backupSizeBytes ?? null,
          enabled: task.enabled,
          schedule: task.cronExpression,
          detail: latest?.error ?? latest?.output?.slice(-8000) ?? null,
          verification: null,
        };
        backups.push(backup);
        await c.backups.updateOne(
          { _id: task.id },
          { $set: backup },
          { upsert: true },
        );
        for (const run of monitoring.backups.runs.filter(
          (run) => run.taskId === task.id,
        )) {
          await c.backupRuns.updateOne(
            { _id: run.id },
            {
              $set: {
                ...backup,
                runId: run.id,
                status: run.status,
                startedAt: run.startedAt,
                completedAt: run.completedAt,
                durationMs: run.metadata?.durationMs ?? null,
                sizeBytes: run.metadata?.backupSizeBytes ?? null,
                detail: run.error ?? run.output?.slice(-8000) ?? null,
                expiresAt: new Date(Date.parse(run.createdAt) + 91 * 86400_000),
              },
            },
            { upsert: true },
          );
        }
      }
    }
    const snapshot: Snapshot = {
      _id: "latest",
      at: stamp(),
      services: observed,
      backups,
      warnings,
    };
    const minute = new Date(Math.floor(now / 60_000) * 60_000);
    await c.samples.bulkWrite(
      observed.map((service) => ({
        updateOne: {
          filter: { _id: `${service.id}:${minute.toISOString()}` },
          update: {
            $setOnInsert: {
              serviceId: service.id,
              at: minute,
              status: service.status,
              latencyMs: service.latencyMs,
              evidence: service.evidence.filter(
                (item) => item.status !== "operational",
              ),
            },
          },
          upsert: true,
        },
      })),
    );
    // Recompute only recent daily buckets. Replacing deterministic aggregates
    // is retry-safe; the public page never scans months of individual checks.
    await c.samples
      .aggregate([
        {
          $match: {
            at: {
              $gte: new Date(
                Date.UTC(
                  new Date().getUTCFullYear(),
                  new Date().getUTCMonth(),
                  new Date().getUTCDate() - 1,
                ),
              ),
            },
          },
        },
        {
          $group: {
            _id: {
              serviceId: "$serviceId",
              day: {
                $dateToString: {
                  format: "%Y-%m-%d",
                  date: "$at",
                  timezone: "UTC",
                },
              },
            },
            operational: {
              $sum: { $cond: [{ $eq: ["$status", "operational"] }, 1, 0] },
            },
            degraded: {
              $sum: { $cond: [{ $eq: ["$status", "degraded"] }, 1, 0] },
            },
            down: { $sum: { $cond: [{ $eq: ["$status", "down"] }, 1, 0] } },
            unknown: {
              $sum: {
                $cond: [{ $in: ["$status", ["unknown", "maintenance"]] }, 1, 0],
              },
            },
          },
        },
        {
          $project: {
            _id: { $concat: ["$_id.serviceId", ":", "$_id.day"] },
            serviceId: "$_id.serviceId",
            day: "$_id.day",
            operational: 1,
            degraded: 1,
            down: 1,
            unknown: 1,
            expiresAt: {
              $dateAdd: {
                startDate: { $dateFromString: { dateString: "$_id.day" } },
                unit: "day",
                amount: 91,
              },
            },
          },
        },
        {
          $merge: {
            into: "status_daily",
            on: "_id",
            whenMatched: "replace",
            whenNotMatched: "insert",
          },
        },
      ])
      .toArray();
    await c.snapshots.replaceOne({ _id: "latest" }, snapshot, { upsert: true });

    const syncIncident = async (item: BetterResource) => {
      if (!numericId(item.id)) return;
      const monitorId = item.relationships?.monitor?.data?.id;
      const heartbeatId = item.relationships?.heartbeat?.data?.id;
      const serviceId = monitorId
        ? monitorMap.get(monitorId)
        : heartbeatId
          ? `heartbeat:${heartbeatId}`
          : undefined;
      const startedAt = textAttribute(item, "started_at");
      if (!startedAt || !Number.isFinite(Date.parse(startedAt))) return;
      const service = observed.find((entry) => entry.id === serviceId);
      const originalSample = serviceId
        ? await c.samples.findOne(
            {
              serviceId,
              at: {
                $gte: new Date(Date.parse(startedAt) - 180_000),
                $lte: new Date(Date.parse(startedAt) + 180_000),
              },
            },
            { sort: { at: 1 } },
          )
        : null;
      const incidentEvidence =
        originalSample?.evidence ??
        (Math.abs(Date.now() - Date.parse(startedAt)) < 180_000
          ? (service?.evidence ?? [])
          : []);
      const event: Incident = {
        _id: `betterstack:${item.id}`,
        betterStackId: item.id,
        title: service
          ? `${service.name} interruption`
          : "Service interruption",
        serviceIds: serviceId ? [serviceId] : [],
        startedAt,
        acknowledgedAt: textAttribute(item, "acknowledged_at"),
        resolvedAt: textAttribute(item, "resolved_at"),
        cause:
          textAttribute(item, "cause") ??
          "The monitor did not provide a failure reason.",
        evidence: incidentEvidence,
        updates: [],
      };
      const { acknowledgedAt, resolvedAt, cause, ...initial } = event;
      // Store contemporaneous evidence once; later recovery samples never rewrite it.
      await c.incidents.updateOne(
        { _id: event._id },
        { $setOnInsert: initial, $set: { acknowledgedAt, resolvedAt, cause } },
        { upsert: true },
      );
      const stored = await c.incidents.findOne({ _id: event._id });
      if (stored && !stored.enrichmentSentAt && !stored.resolvedAt) {
        const notes = stored.evidence
          .filter((e) => e.status !== "operational")
          .map(
            (e) =>
              `${e.source}: ${e.status}${e.detail ? ` — ${e.detail}` : ""}`,
          );
        await betterRequest(`/api/v2/incidents/${item.id}/comments`, {
          method: "POST",
          body: JSON.stringify({
            content: `Status page evidence (${stored.startedAt}). These observations are not a confirmed root cause.\n\n${notes.join("\n") || "No matching dependency observations were available. Investigation is required."}\n\nReference: ${stored._id}`,
          }),
        });
        await c.incidents.updateOne(
          { _id: stored._id },
          { $set: { enrichmentSentAt: stamp() } },
        );
      }
    };
    // Import recent history and explicitly re-fetch unresolved local incidents;
    // absence from a page/list is never interpreted as recovery.
    await provider("Incident history", async () => {
      const since = new Date(Date.now() - 90 * 86400_000)
        .toISOString()
        .slice(0, 10);
      const recent = await betterList(
        `/api/v3/incidents?per_page=50&from=${since}`,
      );
      const local = await c.incidents
        .find({ betterStackId: { $ne: null }, resolvedAt: null })
        .toArray();
      const byId = new Map(
        [...recent, ...(incidents ?? [])].map((item) => [item.id, item]),
      );
      for (const event of local)
        if (event.betterStackId && !byId.has(event.betterStackId)) {
          const result = z
            .object({
              data: z.object({
                id: z.string(),
                attributes: z.record(z.string(), z.unknown()),
                relationships: z
                  .record(
                    z.string(),
                    z.object({ data: z.object({ id: z.string() }).nullable() }),
                  )
                  .optional(),
              }),
            })
            .parse(
              await betterRequest(`/api/v3/incidents/${event.betterStackId}`),
            );
          byId.set(result.data.id, result.data);
        }
      await mapConcurrent(Array.from(byId.values()), 3, syncIncident);
    });
    // Every 5 minutes, retain all available regional samples. Overlapping data
    // is deduplicated by monitor/region/timestamp, including repeated cron calls.
    if (Math.floor(now / 60_000) % 5 === 0 || !previous) {
      await mapConcurrent(
        (monitors ?? []).filter((m) => numericId(m.id)),
        3,
        (monitor) =>
          provider(`Timings ${monitor.id}`, async () => {
            const parsed = responseTimesSchema.parse(
              await betterRequest(
                `/api/v2/monitors/${monitor.id}/response-times`,
              ),
            );
            const samples: Timing[] = parsed.data.attributes.regions.flatMap(
              ({ region, response_times }) =>
                response_times.map((point) => ({
                  _id: `${monitor.id}:${region}:${point.at}`,
                  serviceId: monitorMap.get(monitor.id)!,
                  region,
                  at: new Date(point.at),
                  total: point.response_time * 1000,
                  dns:
                    point.name_lookup_time == null
                      ? null
                      : point.name_lookup_time * 1000,
                  connection:
                    point.connection_time == null
                      ? null
                      : point.connection_time * 1000,
                  tls:
                    point.tls_handshake_time == null
                      ? null
                      : point.tls_handshake_time * 1000,
                  transfer:
                    point.data_transfer_time == null
                      ? null
                      : point.data_transfer_time * 1000,
                })),
            );
            for (let offset = 0; offset < samples.length; offset += 1000)
              await c.timings.bulkWrite(
                samples.slice(offset, offset + 1000).map((sample) => ({
                  updateOne: {
                    filter: { _id: sample._id },
                    update: { $setOnInsert: sample },
                    upsert: true,
                  },
                })),
              );
          }),
      );
    }
    await c.snapshots.updateOne({ _id: "latest" }, { $set: { warnings } });
    return { skipped: false, services: observed.length, warnings };
  } finally {
    await c.leases.updateOne(
      { _id: "collector", owner },
      { $set: { until: new Date(0) } },
    );
  }
}
