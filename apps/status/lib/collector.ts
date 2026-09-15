import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  AGENT_COOLDOWN_MS,
  agentConfig,
  startTriageRun,
  triagePrompt,
} from "./agent";
import {
  type BetterResource,
  betterList,
  betterRequest,
  mapConcurrent,
  responseTimesSchema,
  textAttribute,
} from "./better-stack";
import { appOrigins, catalog } from "./catalog";
import {
  bindingTarget,
  type DiscoveredSource,
  monitorEnvMap,
  resolveBinding,
  type SourceKind,
  sourceKey,
} from "./config";
import { monitoringSchema } from "./contracts";
import { collections, statusConfig } from "./db";
import {
  combineHealth,
  confirmStatus,
  fromCheck,
  maintenanceCovers,
  STREAK_WINDOW_MS,
  summarizeService,
} from "./health";
import {
  describeEvidence,
  isProblem,
  newAutoIncident,
  planIncidents,
  statusWord,
  systemUpdate,
} from "./incidents";
import type {
  Backup,
  Evidence,
  Health,
  Incident,
  Service,
  Snapshot,
  Timing,
} from "./model";
import { probeApp } from "./probe";

const apiOrigin = () =>
  process.env.STATUS_CLOUD_API_URL ?? "https://api.denizlg24.com";
const stamp = () => new Date().toISOString();
const numericId = (id: string) => /^\d+$/.test(id);
function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message.slice(0, 500)
    : "Collection failed";
}
function describeSource(
  kind: SourceKind,
  item: BetterResource,
  seenAt: string,
): DiscoveredSource {
  return {
    _id: sourceKey(kind, item.id),
    kind,
    externalId: item.id,
    name:
      textAttribute(item, "pronounceable_name") ??
      textAttribute(item, "name") ??
      `${kind === "monitor" ? "Monitor" : "Heartbeat"} ${item.id}`,
    url: textAttribute(item, "url"),
    monitorType: textAttribute(item, "monitor_type"),
    upstreamStatus: textAttribute(item, "status"),
    lastCheckedAt:
      textAttribute(item, "last_checked_at") ??
      textAttribute(item, "last_ping_at"),
    lastSeenAt: seenAt,
    missingSince: null,
  };
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
    const [previous, config] = await Promise.all([
      c.snapshots.findOne({ _id: "latest" }),
      statusConfig(),
    ]);
    const envMap = monitorEnvMap();
    const warnings: string[] = [];
    const evidence = new Map<string, Evidence[]>();
    const services = new Map(catalog.map((service) => [service.id, service]));
    // Retain a previously discovered service on a provider outage, as unknown —
    // but only one that can still be re-derived. A Better Stack source that is no
    // longer bound has nothing left to report, and retaining it unconditionally is
    // why renamed and deleted monitors stayed on the page forever with no
    // evidence at all. Host-readiness ids carry no source prefix, so they survive.
    const adopted = new Set(
      Object.entries(config.bindings)
        .filter(([, binding]) => binding.kind === "own")
        .map(([id]) => id),
    );
    for (const service of previous?.services ?? [])
      if (
        !services.has(service.id) &&
        (adopted.has(service.id) || !/^(?:monitor|heartbeat):/.test(service.id))
      )
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
        const result = await probeApp(id, origin);
        add(id, {
          source: "Application runtime",
          status: result.status,
          at: stamp(),
          latencyMs: result.latencyMs,
          detail: result.detail,
        });
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
    const seenAt = stamp();
    const discovered: DiscoveredSource[] = [];
    // Source key -> the service its evidence is attributed to, or null when the
    // admin has not chosen it. Nothing reaches the page on discovery alone.
    const sourceTarget = new Map<string, string | null>();
    const bind = (source: DiscoveredSource) => {
      discovered.push(source);
      const binding = resolveBinding(config, source, envMap);
      const target = bindingTarget(binding, source._id);
      sourceTarget.set(source._id, target);
      if (target && binding.kind === "own")
        services.set(target, {
          ...(services.get(target) ?? {
            status: "unknown",
            checkedAt: null,
            latencyMs: null,
            evidence: [],
          }),
          id: target,
          name: binding.name.trim() || source.name,
          group: binding.group,
          description: binding.description,
        });
      return target;
    };
    for (const monitor of monitors ?? []) {
      if (!numericId(monitor.id)) continue;
      const source = describeSource("monitor", monitor, seenAt);
      const target = bind(source);
      if (!target) continue;
      const state = source.upstreamStatus ?? "unknown";
      add(target, {
        source: `Better Stack monitor ${monitor.id}`,
        status: state === "validating" ? "degraded" : fromCheck(state),
        at: state === "maintenance" ? seenAt : (source.lastCheckedAt ?? ""),
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
      if (!numericId(heartbeat.id)) continue;
      const source = describeSource("heartbeat", heartbeat, seenAt);
      const target = bind(source);
      if (!target) continue;
      add(target, {
        source: `Better Stack heartbeat ${heartbeat.id}`,
        status: fromCheck(source.upstreamStatus ?? "unknown"),
        at: seenAt,
        latencyMs: null,
        detail: source.lastCheckedAt
          ? `Last ping: ${source.lastCheckedAt}`
          : "No ping timestamp available",
      });
    }
    // Keep the picker populated from what was actually seen, so the admin can
    // choose sources while Better Stack itself is unreachable, and can tell a
    // source that has gone away upstream from one that is merely unchosen.
    const incidentTarget = (item: BetterResource) => {
      const monitorId = item.relationships?.monitor?.data?.id;
      const heartbeatId = item.relationships?.heartbeat?.data?.id;
      const key = monitorId
        ? sourceKey("monitor", monitorId)
        : heartbeatId
          ? sourceKey("heartbeat", heartbeatId)
          : null;
      return key ? (sourceTarget.get(key) ?? undefined) : undefined;
    };
    if (discovered.length) {
      await c.sources.bulkWrite(
        discovered.map((source) => ({
          updateOne: {
            filter: { _id: source._id },
            update: { $set: source },
            upsert: true,
          },
        })),
      );
      if (monitors && heartbeats)
        await c.sources.updateMany(
          {
            _id: { $nin: discovered.map((source) => source._id) },
            missingSince: null,
          },
          { $set: { missingSince: seenAt } },
        );
    }
    // Active incidents are a separate signal; a passing probe cannot resolve them.
    for (const incident of incidents ?? []) {
      const id = incidentTarget(incident);
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
    const nowIso = new Date(now).toISOString();
    const minute = new Date(Math.floor(now / 60_000) * 60_000);
    const raw = Array.from(services.values()).map((service) =>
      summarizeService(service, evidence.get(service.id) ?? [], now),
    );
    // The confirmation streaks read the preceding samples' raw verdicts, and
    // the previous snapshot carries the status each service was last confirmed
    // at; one failed observation degrades, only repeated ones take a service
    // down, and only repeated clean ones bring it back.
    const [recentSamples, windows] = await Promise.all([
      c.samples
        .find(
          {
            at: { $gte: new Date(now - STREAK_WINDOW_MS), $lt: minute },
          },
          { projection: { serviceId: 1, at: 1, status: 1, observed: 1 } },
        )
        .sort({ at: -1 })
        .toArray(),
      c.maintenance.find({ cancelledAt: null }).toArray(),
    ]);
    const recentByService = new Map<string, Health[]>();
    for (const sample of recentSamples)
      recentByService.set(sample.serviceId, [
        ...(recentByService.get(sample.serviceId) ?? []),
        sample.observed ?? sample.status,
      ]);
    const previousByService = new Map(
      (previous?.services ?? []).map((service) => [service.id, service]),
    );
    const underMaintenance = new Set(
      windows
        .filter((window) => maintenanceCovers(window, now))
        .flatMap((window) => window.serviceIds),
    );
    const confirm = (service: Service, status: Health): Service => {
      const last = previousByService.get(service.id);
      const confirmed = underMaintenance.has(service.id)
        ? "maintenance"
        : confirmStatus(
            status,
            last?.status ?? "unknown",
            recentByService.get(service.id) ?? [],
          );
      return {
        ...service,
        status: confirmed,
        observed: status,
        since: confirmed === last?.status ? (last.since ?? nowIso) : nowIso,
      };
    };
    let observed = raw.map((service) => confirm(service, service.status));
    // A dependency's *confirmed* outage degrades what depends on it; its raw
    // blips stay its own.
    const dependencies: Record<string, string[]> = {
      api: ["postgres", "mongodb", "redis"],
      cloud: ["api", "postgres", "mongodb", "redis"],
      forge: ["api", "deploy-agent"],
      storage: ["api", "posix", "objectStorage", "storageProtocol", "search"],
    };
    const confirmedById = new Map(observed.map((entry) => [entry.id, entry]));
    for (const [id, required] of Object.entries(dependencies)) {
      const service = confirmedById.get(id);
      if (!service) continue;
      const signals: Evidence[] = required.map((dependency) => {
        const result = confirmedById.get(dependency);
        return {
          source: `Dependency · ${result?.name ?? dependency}`,
          status:
            result?.status === "down"
              ? "degraded"
              : (result?.status ?? "unknown"),
          at: result?.checkedAt ?? nowIso,
          latencyMs: null,
          detail:
            result?.status === "down"
              ? "A required dependency is unavailable; application features may be affected."
              : null,
        };
      });
      const status = underMaintenance.has(id)
        ? "maintenance"
        : combineHealth([
            service.status,
            ...signals.map((item) => item.status),
          ]);
      observed = observed.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              status,
              evidence: [...entry.evidence, ...signals],
              since:
                status === previousByService.get(id)?.status
                  ? (previousByService.get(id)?.since ?? nowIso)
                  : nowIso,
            }
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
    await c.samples.bulkWrite(
      observed.map((service) => ({
        updateOne: {
          filter: { _id: `${service.id}:${minute.toISOString()}` },
          update: {
            $setOnInsert: {
              serviceId: service.id,
              at: minute,
              status: service.status,
              observed: service.observed ?? service.status,
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

    // Incidents are derived from confirmed status, not mirrored from Better
    // Stack: its incident opens on its own confirmation rules and lands here
    // only as evidence. A Better Stack incident that coincides with one of
    // ours is linked so acknowledge, resolve and the enrichment comment reach
    // it.
    const opened = await provider("Incident reconciliation", async () => {
      const open = await c.incidents.find({ resolvedAt: null }).toArray();
      const plan = planIncidents({ services: observed, open, now });
      const created: Incident[] = [];
      for (const group of plan.open) {
        const incident = newAutoIncident(group.services, nowIso);
        const upstream = (incidents ?? []).find((item) => {
          const target = incidentTarget(item);
          const startedAt = textAttribute(item, "started_at");
          return (
            !!target &&
            incident.serviceIds.includes(target) &&
            !!startedAt &&
            Math.abs(now - Date.parse(startedAt)) < 5 * 60_000
          );
        });
        if (upstream) incident.betterStackId = upstream.id;
        await c.incidents.insertOne(incident);
        created.push(incident);
      }
      for (const { incidentId, service } of plan.merge)
        await c.incidents.updateOne(
          { _id: incidentId },
          {
            $addToSet: { serviceIds: service.id },
            $push: {
              evidence: { $each: service.evidence.filter(isProblem) },
              updates: systemUpdate(
                "investigating",
                "private",
                `${service.name} is also affected.\n${describeEvidence(service.evidence).join("\n")}`,
                nowIso,
              ),
            },
          },
        );
      for (const incidentId of plan.recover)
        await c.incidents.updateOne(
          { _id: incidentId },
          {
            $set: { recoveredAt: nowIso },
            $push: {
              updates: systemUpdate(
                "monitoring",
                "public",
                "Service has been restored. Monitoring continues to confirm the recovery holds.",
                nowIso,
              ),
            },
          },
        );
      for (const { incidentId, service } of plan.regress)
        await c.incidents.updateOne(
          { _id: incidentId },
          {
            $set: { recoveredAt: null },
            $push: {
              updates: systemUpdate(
                "investigating",
                "private",
                `${service.name} is ${statusWord(service.status)} again.`,
                nowIso,
              ),
            },
          },
        );
      for (const incidentId of plan.resolve) {
        const incident = open.find((item) => item._id === incidentId);
        await c.incidents.updateOne(
          { _id: incidentId },
          {
            $set: { resolvedAt: nowIso },
            $push: {
              updates: systemUpdate(
                "resolved",
                "public",
                `Resolved. Service was restored at ${incident?.recoveredAt ?? nowIso} and has remained stable since.`,
                nowIso,
              ),
            },
          },
        );
      }
      return created;
    });
    // Better Stack gets our evidence as a comment on its own incident, once.
    await provider("Incident enrichment", async () => {
      const linked = await c.incidents
        .find({
          _id: { $regex: /^auto:/ },
          betterStackId: { $ne: null },
          enrichmentSentAt: { $exists: false },
          resolvedAt: null,
        })
        .toArray();
      for (const stored of linked) {
        if (!stored.betterStackId) continue;
        const notes = describeEvidence(stored.evidence);
        await betterRequest(
          `/api/v2/incidents/${stored.betterStackId}/comments`,
          {
            method: "POST",
            body: JSON.stringify({
              content: `Status page evidence (${stored.startedAt}). These observations are not a confirmed root cause.\n\n${notes.join("\n") || "No matching dependency observations were available. Investigation is required."}\n\nReference: ${stored._id}`,
            }),
          },
        );
        await c.incidents.updateOne(
          { _id: stored._id },
          { $set: { enrichmentSentAt: stamp() } },
        );
      }
    });
    // Rows mirrored before incidents were derived here still follow their
    // upstream to resolution; absence from a list is never read as recovery.
    await provider("Legacy incident settlement", async () => {
      const legacy = await c.incidents
        .find({ _id: { $regex: /^betterstack:/ }, resolvedAt: null })
        .toArray();
      for (const event of legacy) {
        if (!event.betterStackId) continue;
        const result = z
          .object({
            data: z.object({
              id: z.string(),
              attributes: z.record(z.string(), z.unknown()),
            }),
          })
          .parse(
            await betterRequest(`/api/v3/incidents/${event.betterStackId}`),
          );
        await c.incidents.updateOne(
          { _id: event._id },
          {
            $set: {
              acknowledgedAt: textAttribute(result.data, "acknowledged_at"),
              resolvedAt: textAttribute(result.data, "resolved_at"),
            },
          },
        );
      }
    });
    // Every automatic incident starts one triage run on denizlg24.com, unless
    // one of its services had a run in the last hour — the hysteresis removes
    // most flapping and this catches the rest.
    const agent = agentConfig();
    if (agent && opened?.length)
      await provider("Incident agent", async () => {
        const statusOrigin =
          process.env.STATUS_PUBLIC_URL ?? "https://status.denizlg24.com";
        for (const incident of opened) {
          const recent = await c.incidents.findOne({
            _id: { $ne: incident._id },
            agentRunId: { $nin: [null, ""] },
            serviceIds: { $in: incident.serviceIds },
            startedAt: {
              $gte: new Date(now - AGENT_COOLDOWN_MS).toISOString(),
            },
          });
          if (recent) {
            await c.incidents.updateOne(
              { _id: incident._id },
              {
                $push: {
                  updates: systemUpdate(
                    "investigating",
                    "private",
                    `Triage skipped: ${recent._id} started a run less than an hour ago.`,
                    nowIso,
                  ),
                },
              },
            );
            continue;
          }
          const members = observed.filter((service) =>
            incident.serviceIds.includes(service.id),
          );
          const runId = await startTriageRun(
            agent,
            triagePrompt(incident, members, statusOrigin),
          );
          await c.incidents.updateOne(
            { _id: incident._id },
            {
              $set: { agentRunId: runId },
              $push: {
                updates: systemUpdate(
                  "investigating",
                  "private",
                  `Triage run ${runId} started.`,
                  nowIso,
                ),
              },
            },
          );
        }
      });
    // Every 5 minutes, retain all available regional samples. Overlapping data
    // is deduplicated by monitor/region/timestamp, including repeated cron calls.
    if (Math.floor(now / 60_000) % 5 === 0 || !previous) {
      await mapConcurrent(
        (monitors ?? []).filter(
          (m) =>
            numericId(m.id) && sourceTarget.get(sourceKey("monitor", m.id)),
        ),
        3,
        (monitor) =>
          provider(`Timings ${monitor.id}`, async () => {
            const serviceId = sourceTarget.get(
              sourceKey("monitor", monitor.id),
            )!;
            const parsed = responseTimesSchema.parse(
              await betterRequest(
                `/api/v2/monitors/${monitor.id}/response-times`,
              ),
            );
            const samples: Timing[] = parsed.data.attributes.regions.flatMap(
              ({ region, response_times }) =>
                response_times.map((point) => ({
                  _id: `${monitor.id}:${region}:${point.at}`,
                  serviceId,
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
