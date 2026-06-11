import { Resource } from "@/models/Resource";
import { connectDB } from "../mongodb";
import { rebootResource, restartService } from "../resource-agent";
import { encryptPassword } from "../safe-email-password";
import type { ToolDefinition } from "./types";

export const resourceTools: ToolDefinition[] = [
  {
    schema: {
      name: "get_resources",
      description:
        "Get all resources. Returns a list of resources with their details.",
      input_schema: {
        type: "object",
        properties: {},
      },
    },
    isWrite: false,
    category: "resources",
    execute: async () => {
      await connectDB();
      const resources = await Resource.find().lean();
      return resources.map((r) => ({
        id: r._id.toString(),
        name: r.name,
        type: r.type,
        url: r.url,
        description: r.description,
        isActive: r.isActive,
      }));
    },
  },
  {
    schema: {
      name: "get_resource_by_id",
      description: "Get a resource by its ID. Returns the resource details.",
      input_schema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The ID of the resource to retrieve.",
          },
        },
        required: ["id"],
      },
    },
    isWrite: false,
    category: "resources",
    execute: async (input) => {
      const { id } = input;
      await connectDB();
      const resource = await Resource.findById(id).lean();
      if (!resource) {
        return { success: false, message: "Resource not found" };
      }
      return {
        id: resource._id.toString(),
        name: resource.name,
        type: resource.type,
        url: resource.url,
        description: resource.description,
        isActive: resource.isActive,
      };
    },
  },
  {
    schema: {
      name: "get_resource_health",
      description:
        "Get the health status and system metrics (CPU, RAM, disk) of a resource by its ID.",
      input_schema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The ID of the resource to check health for.",
          },
        },
        required: ["id"],
      },
    },
    isWrite: false,
    category: "resources",
    execute: async (input) => {
      const { id } = input;
      await connectDB();
      const resource = await Resource.findById(id).lean();
      if (!resource) {
        return { success: false, message: "Resource not found" };
      }
      const agent = resource.agentService;
      return {
        id: resource._id.toString(),
        name: resource.name,
        agentService: {
          enabled: agent?.enabled ?? false,
          lastCheckedAt: agent?.lastCheckedAt ?? null,
          lastStatus: agent?.lastStatus ?? null,
          lastMetrics: agent?.lastMetrics ?? null,
        },
        status: agent?.lastStatus ?? "unknown",
      };
    },
  },
  {
    schema: {
      name: "get_healthy_resources",
      description:
        "Get all healthy resources. Returns a list of resources with healthy agent service status.",
      input_schema: {
        type: "object",
        properties: {},
      },
    },
    isWrite: false,
    category: "resources",
    execute: async () => {
      await connectDB();
      const resources = await Resource.find({
        "agentService.lastStatus": "healthy",
      }).lean();
      return resources.map((r) => ({
        id: r._id.toString(),
        name: r.name,
        agentService: {
          lastStatus: r.agentService?.lastStatus,
          lastMetrics: r.agentService?.lastMetrics,
        },
      }));
    },
  },
  {
    schema: {
      name: "create_resource",
      description: "Create a new resource with the given details.",
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Name of the resource" },
          url: { type: "string", description: "URL of the resource" },
          type: {
            type: "string",
            description:
              'Type of the resource ("pi" | "vps" | "api" | "service")',
          },
          description: {
            type: "string",
            description: "Description of the resource (optional)",
          },
          isActive: {
            type: "boolean",
            description: "Whether the resource is active (optional)",
          },
          agentServiceEnabled: {
            type: "boolean",
            description: "Enable agent service monitoring for this resource",
          },
          agentServiceNodeId: {
            type: "string",
            description:
              "Node ID for the agent service, must match the agent's configured node_id (optional)",
          },
          agentServiceHmacSecret: {
            type: "string",
            description:
              "HMAC shared secret for signing requests to the agent (optional)",
          },
        },
        required: ["name", "url", "type"],
      },
    },
    isWrite: true,
    category: "resources",
    execute: async (input) => {
      const { name, url, type, description, isActive } = input;
      await connectDB();
      const hmacSecret =
        typeof input.agentServiceHmacSecret === "string" &&
        (input.agentServiceHmacSecret as string).trim()
          ? encryptPassword(input.agentServiceHmacSecret as string)
          : null;
      const newResource = new Resource({
        name,
        url,
        type,
        description,
        isActive,
        agentService: {
          enabled: input.agentServiceEnabled ?? false,
          nodeId: (input.agentServiceNodeId as string) ?? "",
          hmacSecret,
        },
      });
      await newResource.save();
      return {
        id: newResource._id.toString(),
        name: newResource.name,
        url: newResource.url,
        type: newResource.type,
        description: newResource.description,
        isActive: newResource.isActive,
      };
    },
  },
  {
    schema: {
      name: "delete_resource",
      description: "Delete a resource by its ID.",
      input_schema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "ID of the resource to delete",
          },
        },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "resources",
    execute: async (input) => {
      const { id } = input;
      await connectDB();
      const deletedResource = await Resource.findByIdAndDelete(id);
      if (!deletedResource) {
        throw new Error("Resource not found");
      }
      return {
        id: deletedResource._id.toString(),
        name: deletedResource.name,
      };
    },
  },
  {
    schema: {
      name: "update_resource",
      description: "Update a resource by its ID with the given details.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "ID of the resource to update" },
          name: {
            type: "string",
            description: "Name of the resource (optional)",
          },
          url: {
            type: "string",
            description: "URL of the resource (optional)",
          },
          type: {
            type: "string",
            description: "Type of the resource (optional)",
          },
          description: {
            type: "string",
            description: "Description of the resource (optional)",
          },
          isActive: {
            type: "boolean",
            description: "Whether the resource is active (optional)",
          },
          agentServiceEnabled: {
            type: "boolean",
            description: "Enable/disable agent service monitoring (optional)",
          },
          agentServiceNodeId: {
            type: "string",
            description: "Agent service node ID (optional)",
          },
          agentServiceHmacSecret: {
            type: "string",
            description:
              "HMAC shared secret for signing requests to the agent (optional, leave empty to keep current)",
          },
        },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "resources",
    execute: async (input) => {
      const { id, name, url, type, description, isActive } = input;
      await connectDB();

      const updates: Record<string, unknown> = {};
      if (name !== undefined) updates.name = name;
      if (url !== undefined) updates.url = url;
      if (type !== undefined) updates.type = type;
      if (description !== undefined) updates.description = description;
      if (isActive !== undefined) updates.isActive = isActive;
      if (input.agentServiceEnabled !== undefined) {
        updates["agentService.enabled"] = input.agentServiceEnabled;
      }
      if (input.agentServiceNodeId !== undefined) {
        updates["agentService.nodeId"] = input.agentServiceNodeId;
      }
      if (
        typeof input.agentServiceHmacSecret === "string" &&
        (input.agentServiceHmacSecret as string).trim()
      ) {
        updates["agentService.hmacSecret"] = encryptPassword(
          input.agentServiceHmacSecret as string,
        );
      }

      const updatedResource = await Resource.findByIdAndUpdate(
        id,
        { $set: updates },
        { new: true },
      );
      if (!updatedResource) {
        throw new Error("Resource not found");
      }
      return {
        id: updatedResource._id.toString(),
        name: updatedResource.name,
        url: updatedResource.url,
        type: updatedResource.type,
      };
    },
  },
  {
    schema: {
      name: "reboot_resource",
      description:
        "Reboot a resource via its agent service. Requires agent service to be enabled.",
      input_schema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "ID of the resource to reboot",
          },
        },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "resources",
    execute: async (input) => {
      const { id } = input;
      await connectDB();
      const resource = await Resource.findById(id);
      if (!resource) throw new Error("Resource not found");
      const result = await rebootResource(resource);
      if (!result.success) throw new Error(result.error ?? "Reboot failed");
      return {
        success: true,
        message: `Reboot initiated for ${resource.name}`,
      };
    },
  },
  {
    schema: {
      name: "restart_resource_service",
      description:
        "Restart a specific service on a resource via its agent service.",
      input_schema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "ID of the resource",
          },
          serviceName: {
            type: "string",
            description:
              "Name of the service to restart (e.g. 'nginx', 'picron')",
          },
        },
        required: ["id", "serviceName"],
      },
    },
    isWrite: true,
    category: "resources",
    execute: async (input) => {
      const { id, serviceName } = input;
      await connectDB();
      const resource = await Resource.findById(id);
      if (!resource) throw new Error("Resource not found");
      const result = await restartService(resource, serviceName as string);
      if (!result.success) throw new Error(result.error ?? "Restart failed");
      return {
        success: true,
        message: `Service "${serviceName}" restart initiated on ${resource.name}`,
      };
    },
  },
];
