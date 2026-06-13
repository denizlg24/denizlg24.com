import { Server } from "lucide-react";
import { redirect } from "next/navigation";
import { connectDB } from "@/lib/mongodb";
import { getAdminSession } from "@/lib/require-admin";
import { getUptimeData } from "@/lib/resource-agent";
import { Resource } from "@/models/Resource";
import { AdminPageHeader } from "../_components/admin-page-header";
import {
  type LeanResource,
  ResourcesManager,
} from "./_components/resources-manager";

export default async function ResourcesPage() {
  const session = await getAdminSession();
  if (!session) redirect("/auth/login");

  await connectDB();
  const raw = await Resource.find().sort({ createdAt: -1 }).lean();

  const resourceIds = raw.map((r) => r._id.toString());
  const uptimeMap = await getUptimeData(resourceIds);

  const resources: LeanResource[] = raw.map((r) => {
    const id = r._id.toString();
    return {
      _id: id,
      name: r.name,
      description: r.description,
      url: r.url,
      type: r.type,
      isActive: r.isActive,
      agentService: r.agentService,
      capabilities: r.capabilities.map((c) => ({
        _id: c._id.toString(),
        type: c.type,
        label: c.label,
        baseUrl: c.baseUrl,
        config: c.config,
        isActive: c.isActive,
      })),
      uptime: uptimeMap.get(id) ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  });

  return (
    <div className="flex flex-col gap-3">
      <AdminPageHeader
        icon={<Server className="size-4 text-muted-foreground" />}
        title="Resources"
      />
      <ResourcesManager initialResources={resources} />
    </div>
  );
}
