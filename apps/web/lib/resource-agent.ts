import crypto from "node:crypto";
import mongoose from "mongoose";
import { getHealthCheckLogModel } from "@/models/resource-db/HealthCheckLog";
import {
  getPingResourceModel,
  type IPingAgentService,
} from "@/models/resource-db/PingResource";
import { getSubResourceModel } from "@/models/resource-db/SubResource";
import { connectResourceDB } from "./mongodb-resource";
import { decryptPassword } from "./safe-email-password";
import { runSubResourceCheck } from "./sub-resource-check";
import { dateKeyInTz, getAppTimeZone, inTz } from "./timezone";
import {
  computeTimeWeightedUptime,
  dayStatus,
  deriveOutages,
  type Outage,
  type UptimeSample,
  uptimePercent,
} from "./uptime";

const STALE_MS = 10 * 60 * 1000;

export interface AgentCheckResult {
  resourceId: string;
  name: string;
  status: "healthy" | "degraded" | "unreachable";
  metrics: {
    cpuUsagePercent: number | null;
    memoryUsagePercent: number | null;
    diskUsagePercent: number | null;
  } | null;
  services: Array<{ name: string; status: string }> | null;
  responseTimeMs: number | null;
  error?: string;
}

export interface DailyUptimeEntry {
  date: string;
  totalChecks: number;
  healthyChecks: number;
  avgResponseTimeMs: number | null;
  /** Time-weighted, in milliseconds. `observedMs` is the real denominator. */
  healthyMs: number;
  observedMs: number;
  /** Time nothing watched. Not up, and not an outage either. */
  unobservedMs: number;
  status: "up" | "degraded" | "down" | "unknown";
}

export interface ResourceUptimeData {
  resourceId: string;
  /** healthyMs / observedMs over the window — not the ratio of attempts. */
  uptimePercentage: number;
  /** Share of the 30 days nothing observed, which bounds the number above. */
  unobservedPercentage: number;
  /** Inferred from the samples; null when there were too few to infer from. */
  cadenceMs: number | null;
  outages: Outage[];
  dailyHistory: DailyUptimeEntry[];
}

export interface PublicDailyStatus {
  date: string;
  status: "up" | "degraded" | "down" | "unknown";
  totalChecks: number;
  healthyChecks: number;
  avgResponseTimeMs: number | null;
  observedMs: number;
  unobservedMs: number;
}

export interface PublicSubResourceStatus {
  name: string;
  status: "up" | "down" | "stale";
  uptimePercent30d: number;
  /** Published beside the percentage because it is what the percentage omits. */
  unobservedPercent30d: number;
  dailyHistory: PublicDailyStatus[];
}

export interface PublicResourceStatus {
  name: string;
  status: "up" | "degraded" | "down" | "stale";
  uptimePercent30d: number;
  unobservedPercent30d: number;
  dailyHistory: PublicDailyStatus[];
  subResources: PublicSubResourceStatus[];
}

export interface SubResourceCheckSummary {
  subResourceId: string;
  name: string;
  isHealthy: boolean;
  responseTimeMs: number;
  error?: string;
}

/**
 * Minimum shape needed by the per-resource ping helpers. Both the main
 * `IResource` and the resource-DB `IPingResource` satisfy this.
 */
export interface PingableResource {
  _id: mongoose.Types.ObjectId | string;
  name: string;
  url: string;
  agentService: Pick<
    IPingAgentService,
    "enabled" | "nodeId" | "hmacSecret"
  > | null;
}

function getDecryptedHmacSecret(resource: PingableResource): string | null {
  const secret = resource.agentService?.hmacSecret;
  if (!secret?.ciphertext) return null;
  return decryptPassword(secret.ciphertext, secret.iv, secret.authTag);
}

function buildAuthHeaders(
  nodeId: string,
  rawSecret: string | null,
): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Node-ID": nodeId,
    "X-Timestamp": timestamp,
  };

  if (rawSecret) {
    const secretHash = crypto
      .createHash("sha256")
      .update(rawSecret)
      .digest("hex");
    const hmacKey = Buffer.from(secretHash, "hex");
    const message = nodeId + timestamp;
    headers["X-Signature"] = crypto
      .createHmac("sha256", hmacKey)
      .update(message)
      .digest("hex");
  }

  return headers;
}

async function agentFetch(
  baseUrl: string,
  path: string,
  nodeId: string,
  rawSecret: string | null,
  options: { method?: string; body?: string } = {},
): Promise<Response> {
  const url = `${baseUrl.replace(/\/+$/, "")}${path}`;
  const headers = buildAuthHeaders(nodeId, rawSecret);

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 30_000);

  try {
    return await fetch(url, {
      method: options.method ?? "GET",
      headers,
      signal: controller.signal,
      ...(options.body ? { body: options.body } : {}),
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkResourceHealth(
  resource: PingableResource,
): Promise<AgentCheckResult> {
  const agent = resource.agentService;
  if (!agent?.enabled || !resource.url || !agent.nodeId) {
    return {
      resourceId: resource._id.toString(),
      name: resource.name,
      status: "unreachable",
      metrics: null,
      services: null,
      responseTimeMs: null,
      error: "Agent service not configured",
    };
  }

  const startedAt = Date.now();
  try {
    const rawSecret = getDecryptedHmacSecret(resource);
    const res = await agentFetch(
      resource.url,
      "/resource/health",
      agent.nodeId,
      rawSecret,
    );
    const responseTimeMs = Date.now() - startedAt;

    if (!res.ok) {
      return {
        resourceId: resource._id.toString(),
        name: resource.name,
        status: "unreachable",
        metrics: null,
        services: null,
        responseTimeMs,
        error: `Agent returned ${res.status}`,
      };
    }

    const data = await res.json();

    const sys = data.system;
    const memTotal = sys?.memory?.total ?? 0;
    const memUsed = sys?.memory?.used ?? 0;
    const diskTotal = sys?.disk?.total ?? 0;
    const diskUsed = sys?.disk?.used ?? 0;

    const metrics = {
      cpuUsagePercent:
        sys?.cpu_usage_percent != null
          ? Math.round(sys.cpu_usage_percent * 10) / 10
          : null,
      memoryUsagePercent:
        memTotal > 0 ? Math.round((memUsed / memTotal) * 1000) / 10 : null,
      diskUsagePercent:
        diskTotal > 0 ? Math.round((diskUsed / diskTotal) * 1000) / 10 : null,
    };

    const services: Array<{ name: string; status: string }> =
      data.services ?? [];

    const agentStatus = data.status === "ok" ? "healthy" : "degraded";

    return {
      resourceId: resource._id.toString(),
      name: resource.name,
      status: agentStatus,
      metrics,
      services,
      responseTimeMs,
      error: data.error ?? undefined,
    };
  } catch (err) {
    return {
      resourceId: resource._id.toString(),
      name: resource.name,
      status: "unreachable",
      metrics: null,
      services: null,
      responseTimeMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function rebootResource(resource: PingableResource): Promise<{
  success: boolean;
  message?: string;
  error?: string;
}> {
  const agent = resource.agentService;
  if (!agent?.enabled || !resource.url || !agent.nodeId) {
    return { success: false, error: "Agent service not configured" };
  }

  try {
    const rawSecret = getDecryptedHmacSecret(resource);
    const body = JSON.stringify({ action: "reboot" });
    const res = await agentFetch(
      resource.url,
      "/resource/command",
      agent.nodeId,
      rawSecret,
      { method: "POST", body },
    );

    const data = await res.json().catch(() => null);

    if (res.status === 202) {
      return { success: true, message: data?.message ?? "Reboot accepted" };
    }

    return {
      success: false,
      error: data?.message ?? `Agent returned ${res.status}`,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function restartService(
  resource: PingableResource,
  serviceName: string,
): Promise<{ success: boolean; message?: string; error?: string }> {
  const agent = resource.agentService;
  if (!agent?.enabled || !resource.url || !agent.nodeId) {
    return { success: false, error: "Agent service not configured" };
  }

  try {
    const rawSecret = getDecryptedHmacSecret(resource);
    const body = JSON.stringify({
      action: "restart_service",
      service: serviceName,
    });
    const res = await agentFetch(
      resource.url,
      "/resource/command",
      agent.nodeId,
      rawSecret,
      { method: "POST", body },
    );

    const data = await res.json().catch(() => null);

    if (res.status === 202) {
      return { success: true, message: data?.message ?? "Restart accepted" };
    }

    if (res.status === 403) {
      return {
        success: false,
        error: data?.message ?? `Service "${serviceName}" is not monitored`,
      };
    }

    return {
      success: false,
      error: data?.message ?? `Agent returned ${res.status}`,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function getServicesList(resource: PingableResource): Promise<{
  services: Array<{ name: string; status: string }>;
  error?: string;
}> {
  const result = await checkResourceHealth(resource);
  if (result.status === "unreachable") {
    return { services: [], error: result.error };
  }
  return { services: result.services ?? [] };
}

export async function runAllHealthChecks(
  force = false,
): Promise<AgentCheckResult[]> {
  await connectResourceDB();
  const PingResource = await getPingResourceModel();
  const HealthCheckLog = await getHealthCheckLogModel();

  const resources = await PingResource.find({
    isActive: true,
    "agentService.enabled": true,
  });

  const results: AgentCheckResult[] = [];

  for (const resource of resources) {
    if (!force && resource.agentService.lastCheckedAt) {
      const elapsed =
        Date.now() - new Date(resource.agentService.lastCheckedAt).getTime();
      if (elapsed < 5 * 60 * 1000) continue;
    }

    const result = await checkResourceHealth(resource);
    const checkedAt = new Date();

    await PingResource.updateOne(
      { _id: resource._id },
      {
        $set: {
          "agentService.lastCheckedAt": checkedAt,
          "agentService.lastStatus": result.status,
          "agentService.lastMetrics": result.metrics,
        },
      },
    );

    await HealthCheckLog.create({
      resourceId: resource._id,
      status: result.status === "unreachable" ? null : 200,
      responseTimeMs: result.responseTimeMs,
      isHealthy: result.status !== "unreachable",
      error: result.error,
      checkedAt,
    });

    results.push(result);
  }

  await runAllSubResourceChecks(force);

  return results;
}

export async function runAllSubResourceChecks(
  force = false,
): Promise<SubResourceCheckSummary[]> {
  await connectResourceDB();
  const SubResource = await getSubResourceModel();
  const HealthCheckLog = await getHealthCheckLogModel();

  const PingResource = await getPingResourceModel();
  const activeParents = await PingResource.find({ isActive: true }).distinct(
    "_id",
  );
  const subResources = await SubResource.find({
    isActive: true,
    parentResourceId: { $in: activeParents },
  });
  const responses = new Map<string, Promise<Response>>();
  const summaries: SubResourceCheckSummary[] = [];

  for (const sub of subResources) {
    if (!force && sub.lastCheckedAt) {
      const elapsed = Date.now() - new Date(sub.lastCheckedAt).getTime();
      if (elapsed < 5 * 60 * 1000) continue;
    }

    const result = await runSubResourceCheck(sub.check, responses);
    const checkedAt = new Date();

    await SubResource.updateOne(
      { _id: sub._id },
      {
        $set: {
          lastCheckedAt: checkedAt,
          lastStatus: result.isHealthy ? "healthy" : "unhealthy",
          lastResponseTimeMs: result.responseTimeMs,
        },
      },
    );

    await HealthCheckLog.create({
      resourceId: sub._id,
      status: result.status,
      responseTimeMs: result.responseTimeMs,
      isHealthy: result.isHealthy,
      error: result.error,
      checkedAt,
    });

    summaries.push({
      subResourceId: sub._id.toString(),
      name: sub.name,
      isHealthy: result.isHealthy,
      responseTimeMs: result.responseTimeMs,
      error: result.error,
    });
  }

  return summaries;
}

export async function getUptimeData(
  resourceIds: string[],
): Promise<Map<string, ResourceUptimeData>> {
  const HealthCheckLog = await getHealthCheckLogModel();
  const timeZone = await getAppTimeZone();

  const windowEndMs = Date.now();
  const thirtyDaysAgo = new Date(windowEndMs);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const windowStartMs = thirtyDaysAgo.getTime();

  const objectIds = resourceIds.map((id) => new mongoose.Types.ObjectId(id));

  // Per-day counts still answer "how often was this probed", which the UI shows
  // alongside the time-weighted figure; they are no longer what uptime is.
  const countsByResource = new Map<string, Map<string, RawDayCounts>>();
  const counts = await HealthCheckLog.aggregate([
    {
      $match: {
        resourceId: { $in: objectIds },
        checkedAt: { $gte: thirtyDaysAgo },
      },
    },
    {
      $group: {
        _id: {
          resourceId: "$resourceId",
          day: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$checkedAt",
              timezone: timeZone,
            },
          },
        },
        totalChecks: { $sum: 1 },
        healthyChecks: { $sum: { $cond: ["$isHealthy", 1, 0] } },
        avgResponseTimeMs: { $avg: "$responseTimeMs" },
      },
    },
  ]);
  for (const row of counts) {
    const resourceId = row._id.resourceId.toString();
    const days = countsByResource.get(resourceId) ?? new Map();
    days.set(row._id.day, {
      totalChecks: row.totalChecks,
      healthyChecks: row.healthyChecks,
      avgResponseTimeMs:
        row.avgResponseTimeMs != null
          ? Math.round(row.avgResponseTimeMs)
          : null,
    });
    countsByResource.set(resourceId, days);
  }

  // The interval maths needs every sample, so this reads the raw timestamps
  // rather than a rollup. Two fields per row keeps that affordable at a
  // 30-day window; if the cadence is ever tightened far enough to make it
  // hurt, the answer is a rollup collection, not a coarser denominator.
  const rows = await HealthCheckLog.find(
    { resourceId: { $in: objectIds }, checkedAt: { $gte: thirtyDaysAgo } },
    { resourceId: 1, checkedAt: 1, isHealthy: 1, _id: 0 },
  )
    .sort({ resourceId: 1, checkedAt: 1 })
    .lean();

  const samplesByResource = new Map<string, UptimeSample[]>();
  for (const row of rows) {
    const resourceId = row.resourceId.toString();
    const list = samplesByResource.get(resourceId) ?? [];
    list.push({ checkedAt: row.checkedAt, isHealthy: Boolean(row.isHealthy) });
    samplesByResource.set(resourceId, list);
  }

  const dayKey = (at: Date) => dateKeyInTz(at, timeZone);
  const uptimeMap = new Map<string, ResourceUptimeData>();

  for (const resourceId of resourceIds) {
    const samples = samplesByResource.get(resourceId) ?? [];
    const weighted = computeTimeWeightedUptime(samples, {
      windowStartMs,
      windowEndMs,
      dayKey,
    });
    const dayCounts = countsByResource.get(resourceId);
    const windowMs = Math.max(1, windowEndMs - windowStartMs);

    const history = buildEmptyHistory(timeZone).map((entry) => {
      const window = weighted.byDay.get(entry.date);
      const observed = dayCounts?.get(entry.date);
      return {
        date: entry.date,
        totalChecks: observed?.totalChecks ?? 0,
        healthyChecks: observed?.healthyChecks ?? 0,
        avgResponseTimeMs: observed?.avgResponseTimeMs ?? null,
        healthyMs: window?.healthyMs ?? 0,
        observedMs: window?.observedMs ?? 0,
        unobservedMs: window?.unobservedMs ?? 0,
        status: dayStatus(window),
      };
    });

    uptimeMap.set(resourceId, {
      resourceId,
      uptimePercentage: uptimePercent(weighted.total),
      unobservedPercentage:
        Math.round((weighted.total.unobservedMs / windowMs) * 10000) / 100,
      cadenceMs: samples.length > 0 ? weighted.cadenceMs : null,
      outages: deriveOutages(samples, windowEndMs),
      dailyHistory: history,
    });
  }

  return uptimeMap;
}

interface RawDayCounts {
  totalChecks: number;
  healthyChecks: number;
  avgResponseTimeMs: number | null;
}

export async function getPublicResourceStatuses(): Promise<
  PublicResourceStatus[]
> {
  const PingResource = await getPingResourceModel();
  const resources = await PingResource.find({
    isActive: true,
    isPublic: true,
  })
    .lean()
    .sort({ name: 1 });

  if (resources.length === 0) return [];

  const SubResource = await getSubResourceModel();
  const subResources = await SubResource.find({
    isActive: true,
    isPublic: true,
    parentResourceId: { $in: resources.map((r) => r._id) },
  })
    .lean()
    .sort({ name: 1 });

  const ids = [
    ...resources.map((r) => r._id.toString()),
    ...subResources.map((s) => s._id.toString()),
  ];
  const uptimeMap = await getUptimeData(ids);
  const now = Date.now();

  const toDailyHistory = (uptime: ResourceUptimeData | undefined) =>
    (uptime?.dailyHistory ?? []).map((d) => ({
      date: d.date,
      status: d.status,
      totalChecks: d.totalChecks,
      healthyChecks: d.healthyChecks,
      avgResponseTimeMs: d.avgResponseTimeMs,
      observedMs: d.observedMs,
      unobservedMs: d.unobservedMs,
    }));

  const subsByParent = new Map<string, PublicSubResourceStatus[]>();
  for (const sub of subResources) {
    const uptime = uptimeMap.get(sub._id.toString());

    let status: PublicSubResourceStatus["status"];
    if (
      !sub.lastCheckedAt ||
      now - new Date(sub.lastCheckedAt).getTime() > STALE_MS
    ) {
      status = "stale";
    } else {
      status = sub.lastStatus === "healthy" ? "up" : "down";
    }

    const parentKey = sub.parentResourceId.toString();
    const list = subsByParent.get(parentKey) ?? [];
    list.push({
      name: sub.name,
      status,
      uptimePercent30d: uptime?.uptimePercentage ?? 0,
      unobservedPercent30d: uptime?.unobservedPercentage ?? 100,
      dailyHistory: toDailyHistory(uptime),
    });
    subsByParent.set(parentKey, list);
  }

  return resources.map((r) => {
    const lastCheckedAt = r.agentService?.lastCheckedAt;
    const lastStatus = r.agentService?.lastStatus;
    const uptime = uptimeMap.get(r._id.toString());

    let status: PublicResourceStatus["status"];
    if (!lastCheckedAt || now - new Date(lastCheckedAt).getTime() > STALE_MS) {
      status = "stale";
    } else if (lastStatus === "healthy") {
      status = "up";
    } else if (lastStatus === "degraded") {
      status = "degraded";
    } else {
      status = "down";
    }

    return {
      name: r.name,
      status,
      uptimePercent30d: uptime?.uptimePercentage ?? 0,
      unobservedPercent30d: uptime?.unobservedPercentage ?? 100,
      dailyHistory: toDailyHistory(uptime),
      subResources: subsByParent.get(r._id.toString()) ?? [],
    };
  });
}

function buildEmptyHistory(timeZone: string): DailyUptimeEntry[] {
  const history: DailyUptimeEntry[] = [];
  const now = inTz(new Date(), timeZone);
  for (let i = 29; i >= 0; i--) {
    const d = inTz(now, timeZone);
    d.setDate(d.getDate() - i);
    history.push({
      date: dateKeyInTz(d, timeZone),
      totalChecks: 0,
      healthyChecks: 0,
      avgResponseTimeMs: null,
      healthyMs: 0,
      observedMs: 0,
      unobservedMs: 0,
      status: "unknown",
    });
  }
  return history;
}
