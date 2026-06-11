import type { Types } from "mongoose";
import { getPingResourceModel } from "@/models/resource-db/PingResource";
import type { IAgentService, IResource } from "@/models/Resource";

interface SyncableResource {
  _id: Types.ObjectId | string;
  name: string;
  url: string;
  isActive: boolean;
  isPublic?: boolean;
  agentService?: IAgentService | null;
}

export async function upsertPingResource(
  resource: SyncableResource | IResource,
): Promise<void> {
  try {
    const PingResource = await getPingResourceModel();
    const agent = resource.agentService;
    await PingResource.findByIdAndUpdate(
      resource._id,
      {
        $set: {
          name: resource.name,
          url: resource.url,
          isActive: resource.isActive,
          isPublic: resource.isPublic ?? true,
          "agentService.enabled": agent?.enabled ?? false,
          "agentService.nodeId": agent?.nodeId ?? "",
          "agentService.hmacSecret": agent?.hmacSecret ?? null,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  } catch (err) {
    console.error("upsertPingResource failed", { id: resource._id, err });
  }
}

export async function deletePingResource(
  id: Types.ObjectId | string,
): Promise<void> {
  try {
    const PingResource = await getPingResourceModel();
    await PingResource.findByIdAndDelete(id);
  } catch (err) {
    console.error("deletePingResource failed", { id, err });
  }
}
