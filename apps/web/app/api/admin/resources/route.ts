import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { getUptimeData } from "@/lib/resource-agent";
import { encryptPassword } from "@/lib/safe-email-password";
import { upsertPingResource } from "@/lib/sync-ping-resource";
import { getPingResourceModel } from "@/models/resource-db/PingResource";
import { Resource } from "@/models/Resource";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  await connectDB();
  const resources = await Resource.find().sort({ createdAt: -1 }).lean();

  const resourceIds = resources.map((r) => r._id.toString());
  const [uptimeMap, PingResource] = await Promise.all([
    getUptimeData(resourceIds),
    getPingResourceModel(),
  ]);
  const pingDocs = await PingResource.find({ _id: { $in: resourceIds } }).lean();
  const pingMap = new Map(pingDocs.map((p) => [p._id.toString(), p]));

  return NextResponse.json({
    resources: resources.map((r) => {
      const id = r._id.toString();
      const ping = pingMap.get(id);
      const mergedAgent = {
        ...r.agentService,
        lastCheckedAt: ping?.agentService?.lastCheckedAt ?? null,
        lastStatus: ping?.agentService?.lastStatus ?? null,
        lastMetrics: ping?.agentService?.lastMetrics ?? null,
      };
      return {
        _id: id,
        name: r.name,
        description: r.description,
        url: r.url,
        type: r.type,
        isActive: r.isActive,
        isPublic: r.isPublic,
        agentService: mergedAgent,
        capabilities: r.capabilities.map((c) => ({
          _id: c._id.toString(),
          type: c.type,
          label: c.label,
          baseUrl: c.baseUrl,
          config: c.config,
          isActive: c.isActive,
        })),
        uptime: uptimeMap.get(id) ?? null,
        createdAt: r.createdAt?.toISOString?.() ?? r.createdAt,
        updatedAt: r.updatedAt?.toISOString?.() ?? r.updatedAt,
      };
    }),
  });
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const body = await request.json();
  const { name, url, type, description, isActive, isPublic, agentService } =
    body;

  if (!name || !url || !type) {
    return NextResponse.json(
      { error: "name, url, and type are required" },
      { status: 400 },
    );
  }

  const sanitizedAgent = agentService
    ? {
        enabled: agentService.enabled ?? false,
        nodeId: agentService.nodeId ?? "",
        hmacSecret:
          typeof agentService.hmacSecret === "string" &&
          agentService.hmacSecret.trim()
            ? encryptPassword(agentService.hmacSecret)
            : (agentService.hmacSecret ?? null),
      }
    : {};

  await connectDB();
  const resource = await Resource.create({
    name,
    url,
    type,
    description: description ?? "",
    isActive: isActive ?? true,
    isPublic: isPublic ?? true,
    agentService: sanitizedAgent,
    capabilities: [],
  });

  await upsertPingResource(resource);

  return NextResponse.json(
    {
      ...resource.toObject(),
      _id: resource._id.toString(),
    },
    { status: 201 },
  );
}
