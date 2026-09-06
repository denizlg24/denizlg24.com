import { z } from "zod";

import { Resource } from "@/models/Resource";
import { connectDB } from "../mongodb";
import {
  getServicesList,
  rebootResource,
  restartService,
  runAllHealthChecks,
} from "../resource-agent";
import { encryptPassword } from "../safe-email-password";
import { defineTool, objectId } from "./define";
import type { ToolDefinition } from "./types";

const resourceId = objectId("Resource id exactly as get_resources returned it");

const resourceType = z
  .enum(["pi", "vps", "api", "service"])
  .describe('Type of the resource: one of "pi", "vps", "api", "service"');

const hmacSecretDescription =
  "Raw HMAC shared secret the agent signs requests with. Stored encrypted; it is never readable back.";

/** Every path out of a missing resource, so none of them says only "not found". */
function missingResource(id: string) {
  return `No resource has id "${id}". Call get_resources to see the resource ids that exist.`;
}

export const resourceTools: ToolDefinition[] = [
  defineTool({
    name: "get_resources",
    description:
      "Get all resources. Returns a list of resources with their details.",
    isWrite: false,
    category: "resources",
    input: z.object({}),
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
  }),
  defineTool({
    name: "get_resource_by_id",
    description: "Get a resource by its ID. Returns the resource details.",
    isWrite: false,
    category: "resources",
    input: z.object({ id: resourceId }),
    execute: async (input) => {
      await connectDB();
      const resource = await Resource.findById(input.id).lean();
      if (!resource) {
        return { success: false, message: missingResource(input.id) };
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
  }),
  defineTool({
    name: "get_resource_health",
    description:
      "Get the health status and system metrics (CPU, RAM, disk) of a resource by its ID.",
    isWrite: false,
    category: "resources",
    input: z.object({ id: resourceId }),
    execute: async (input) => {
      await connectDB();
      const resource = await Resource.findById(input.id).lean();
      if (!resource) {
        return { success: false, message: missingResource(input.id) };
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
  }),
  defineTool({
    name: "get_healthy_resources",
    description:
      "Get all healthy resources. Returns a list of resources with healthy agent service status.",
    isWrite: false,
    category: "resources",
    input: z.object({}),
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
  }),
  defineTool({
    name: "create_resource",
    description: "Create a new resource with the given details.",
    isWrite: true,
    category: "resources",
    input: z.object({
      name: z.string().min(1).describe("Name of the resource"),
      url: z
        .string()
        .min(1)
        .describe(
          "Base URL the resource is reached at, e.g. https://api.denizlg24.com",
        ),
      type: resourceType,
      description: z
        .string()
        .optional()
        .describe("Description of the resource (optional)"),
      isActive: z
        .boolean()
        .optional()
        .describe(
          "Whether the resource is active (optional, defaults to true)",
        ),
      agentServiceEnabled: z
        .boolean()
        .default(false)
        .describe("Enable agent service monitoring for this resource"),
      agentServiceNodeId: z
        .string()
        .default("")
        .describe(
          "Node ID for the agent service, must match the agent's configured node_id (optional)",
        ),
      agentServiceHmacSecret: z
        .string()
        .optional()
        .describe(`${hmacSecretDescription} Omit when there is no agent.`),
    }),
    execute: async (input) => {
      const { name, url, type, description, isActive } = input;
      await connectDB();
      const rawSecret = input.agentServiceHmacSecret;
      const hmacSecret = rawSecret?.trim() ? encryptPassword(rawSecret) : null;
      const newResource = new Resource({
        name,
        url,
        type,
        description,
        isActive,
        agentService: {
          enabled: input.agentServiceEnabled,
          nodeId: input.agentServiceNodeId,
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
  }),
  defineTool({
    name: "delete_resource",
    description: "Delete a resource by its ID.",
    isWrite: true,
    category: "resources",
    input: z.object({ id: resourceId }),
    execute: async (input) => {
      await connectDB();
      const deletedResource = await Resource.findByIdAndDelete(input.id);
      if (!deletedResource) {
        throw new Error(missingResource(input.id));
      }
      return {
        id: deletedResource._id.toString(),
        name: deletedResource.name,
      };
    },
  }),
  defineTool({
    name: "update_resource",
    description: "Update a resource by its ID with the given details.",
    isWrite: true,
    category: "resources",
    input: z.object({
      id: resourceId,
      name: z.string().optional().describe("Name of the resource (optional)"),
      url: z
        .string()
        .optional()
        .describe(
          "Base URL the resource is reached at, e.g. https://api.denizlg24.com (optional)",
        ),
      type: resourceType.optional(),
      description: z
        .string()
        .optional()
        .describe("Description of the resource (optional)"),
      isActive: z
        .boolean()
        .optional()
        .describe("Whether the resource is active (optional)"),
      agentServiceEnabled: z
        .boolean()
        .optional()
        .describe("Enable/disable agent service monitoring (optional)"),
      agentServiceNodeId: z
        .string()
        .optional()
        .describe(
          "Agent service node ID, must match the agent's configured node_id (optional)",
        ),
      agentServiceHmacSecret: z
        .string()
        .optional()
        .describe(
          `${hmacSecretDescription} Omit or leave empty to keep the current one.`,
        ),
    }),
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
      const rawSecret = input.agentServiceHmacSecret;
      if (rawSecret?.trim()) {
        updates["agentService.hmacSecret"] = encryptPassword(rawSecret);
      }

      const updatedResource = await Resource.findByIdAndUpdate(
        id,
        { $set: updates },
        { returnDocument: "after" },
      );
      if (!updatedResource) {
        throw new Error(missingResource(id));
      }
      return {
        id: updatedResource._id.toString(),
        name: updatedResource.name,
        url: updatedResource.url,
        type: updatedResource.type,
      };
    },
  }),
  defineTool({
    name: "reboot_resource",
    description:
      "Reboot a resource via its agent service. Requires agent service to be enabled.",
    isWrite: true,
    category: "resources",
    input: z.object({ id: resourceId }),
    execute: async (input) => {
      await connectDB();
      const resource = await Resource.findById(input.id);
      if (!resource) throw new Error(missingResource(input.id));
      const result = await rebootResource(resource);
      if (!result.success) {
        throw new Error(
          `Rebooting ${resource.name} failed: ${result.error ?? "the agent gave no reason"}. Check its agent service with get_resource_health.`,
        );
      }
      return {
        success: true,
        message: `Reboot initiated for ${resource.name}`,
      };
    },
  }),
  defineTool({
    name: "restart_resource_service",
    description:
      "Restart a specific service on a resource via its agent service.",
    isWrite: true,
    category: "resources",
    input: z.object({
      id: resourceId,
      serviceName: z
        .string()
        .min(1)
        .describe(
          "Service name exactly as list_resource_services returned it, e.g. 'nginx', 'picron'",
        ),
    }),
    execute: async (input) => {
      const { id, serviceName } = input;
      await connectDB();
      const resource = await Resource.findById(id);
      if (!resource) throw new Error(missingResource(id));
      const result = await restartService(resource, serviceName);
      if (!result.success) {
        throw new Error(
          `Restarting "${serviceName}" on ${resource.name} failed: ${result.error ?? "the agent gave no reason"}. Call list_resource_services for the names that exist there.`,
        );
      }
      return {
        success: true,
        message: `Service "${serviceName}" restart initiated on ${resource.name}`,
      };
    },
  }),
  defineTool({
    name: "list_resource_services",
    description:
      "Services running on a resource, with their status. Call this before restart_resource_service to get the exact service name.",
    isWrite: false,
    category: "resources",
    input: z.object({ id: resourceId }),
    execute: async (input) => {
      await connectDB();
      const resource = await Resource.findById(input.id);
      if (!resource) throw new Error(missingResource(input.id));
      const result = await getServicesList(resource);
      // An unreachable host reports the reason rather than an empty list: the
      // two are very different answers to "what is running here".
      if (result.error) {
        throw new Error(`${resource.name} is unreachable: ${result.error}`);
      }
      return { resource: resource.name, services: result.services };
    },
  }),
  defineTool({
    name: "run_resource_health_checks",
    description:
      "Run the health check across every active resource with an agent service and record the results. Normally the cron does this; call it to force a check now.",
    isWrite: true,
    category: "resources",
    input: z.object({
      force: z
        .boolean()
        .default(false)
        .describe(
          "Re-check resources checked recently too, instead of skipping them.",
        ),
    }),
    execute: async (input) => {
      const results = await runAllHealthChecks(input.force);
      return {
        checked: results.length,
        results: results.map((result) => ({
          name: result.name,
          status: result.status,
          error: result.error,
        })),
      };
    },
  }),
];
