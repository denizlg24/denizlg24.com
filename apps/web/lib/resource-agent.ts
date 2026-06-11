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
  status: "up" | "degraded" | "down" | "unknown";
}

export interface ResourceUptimeData {
  resourceId: string;
  uptimePercentage: number;
  dailyHistory: DailyUptimeEntry[];
}

export interface PublicDailyStatus {
  date: string;
  status: "up" | "degraded" | "down" | "unknown";
  totalChecks: number;
  healthyChecks: number;
  avgResponseTimeMs: number | null;
}

export interface PublicSubResourceStatus {
  name: string;
  status: "up" | "down" | "stale";
  uptimePercent30d: number;
  dailyHistory: PublicDailyStatus[];
}

export interface PublicResourceStatus {
  name: string;
  status: "up" | "degraded" | "down" | "stale";
  uptimePercent30d: number;
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

  const subResources = await SubResource.find({ isActive: true });
  const summaries: SubResourceCheckSummary[] = [];

  for (const sub of subResources) {
    if (!force && sub.lastCheckedAt) {
      const elapsed = Date.now() - new Date(sub.lastCheckedAt).getTime();
      if (elapsed < 5 * 60 * 1000) continue;
    }

    const result = await runSubResourceCheck(sub.check);
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

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const objectIds = resourceIds.map((id) => new mongoose.Types.ObjectId(id));

  const pipeline = [
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
          day: { $dateToString: { format: "%Y-%m-%d", date: "$checkedAt" } },
        },
        totalChecks: { $sum: 1 },
        healthyChecks: { $sum: { $cond: ["$isHealthy", 1, 0] } },
        avgResponseTimeMs: { $avg: "$responseTimeMs" },
      },
    },
    {
      $sort: { "_id.day": 1 as const },
    },
    {
      $group: {
        _id: "$_id.resourceId",
        days: {
          $push: {
            date: "$_id.day",
            totalChecks: "$totalChecks",
            healthyChecks: "$healthyChecks",
            avgResponseTimeMs: "$avgResponseTimeMs",
          },
        },
        totalChecksAll: { $sum: "$totalChecks" },
        healthyChecksAll: { $sum: "$healthyChecks" },
      },
    },
  ];

  const results = await HealthCheckLog.aggregate(pipeline);

  const uptimeMap = new Map<string, ResourceUptimeData>();

  for (const id of resourceIds) {
    uptimeMap.set(id, {
      resourceId: id,
      uptimePercentage: 0,
      dailyHistory: buildEmptyHistory(),
    });
  }

  for (const row of results) {
    const resourceId = row._id.toString();
    const uptimePercentage =
      row.totalChecksAll > 0
        ? Math.round((row.healthyChecksAll / row.totalChecksAll) * 10000) / 100
        : 0;

    const dayMap = new Map<string, DailyUptimeEntry>();

    for (const day of row.days) {
      const avgMs =
        day.avgResponseTimeMs != null
          ? Math.round(day.avgResponseTimeMs)
          : null;
      let status: DailyUptimeEntry["status"] = "unknown";

      if (day.totalChecks > 0) {
        const ratio = day.healthyChecks / day.totalChecks;
        if (ratio >= 0.9) {
          status = "up";
        } else if (ratio > 0) {
          status = "degraded";
        } else {
          status = "down";
        }
      }

      dayMap.set(day.date, {
        date: day.date,
        totalChecks: day.totalChecks,
        healthyChecks: day.healthyChecks,
        avgResponseTimeMs: avgMs,
        status,
      });
    }

    const history = buildEmptyHistory();
    for (let i = 0; i < history.length; i++) {
      const existing = dayMap.get(history[i].date);
      if (existing) history[i] = existing;
    }

    uptimeMap.set(resourceId, {
      resourceId,
      uptimePercentage,
      dailyHistory: history,
    });
  }

  return uptimeMap;
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
      dailyHistory: toDailyHistory(uptime),
      subResources: subsByParent.get(r._id.toString()) ?? [],
    };
  });
}

function buildEmptyHistory(): DailyUptimeEntry[] {
  const history: DailyUptimeEntry[] = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    history.push({
      date: d.toISOString().slice(0, 10),
      totalChecks: 0,
      healthyChecks: 0,
      avgResponseTimeMs: null,
      status: "unknown",
    });
  }
  return history;
}
