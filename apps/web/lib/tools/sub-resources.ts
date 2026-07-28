import mongoose from "mongoose";
import { getUptimeData } from "@/lib/resource-agent";
import {
  parseSubResourceCheck,
  serializeSubResource,
} from "@/lib/sub-resource-payload";
import { getHealthCheckLogModel } from "@/models/resource-db/HealthCheckLog";
import { getSubResourceModel } from "@/models/resource-db/SubResource";
import type { ToolDefinition } from "./types";

const CHECK_PROPERTY = {
  type: "object",
  description:
    "Health check definition. HTTP: { type: 'http', url, expectStatus?, expectJsonPath?, expectEquals? }. TCP: { type: 'tcp', host, port }.",
} as const;

function requireObjectId(value: unknown, label: string): string {
  const id = typeof value === "string" ? value : "";
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error(`${label} is not a valid id`);
  }
  return id;
}

export const subResourceTools: ToolDefinition[] = [
  {
    schema: {
      name: "list_sub_resources",
      description:
        "List the services tracked under a resource (for example mongodb or redis on pi-cloud) with their check definition and uptime.",
      input_schema: {
        type: "object",
        properties: {
          resourceId: { type: "string", description: "Parent resource ID" },
        },
        required: ["resourceId"],
      },
    },
    isWrite: false,
    category: "resources",
    execute: async (input) => {
      const resourceId = requireObjectId(input.resourceId, "resourceId");
      const SubResource = await getSubResourceModel();
      const subResources = await SubResource.find({
        parentResourceId: resourceId,
      })
        .lean()
        .sort({ name: 1 });
      const uptimeMap = await getUptimeData(
        subResources.map((sub) => sub._id.toString()),
      );
      return subResources.map((sub) => ({
        ...serializeSubResource(sub),
        uptime: uptimeMap.get(sub._id.toString()) ?? null,
      }));
    },
  },
  {
    schema: {
      name: "create_sub_resource",
      description:
        "Add a service under a resource. Its check runs from the backend health-check cron alongside the parent resource.",
      input_schema: {
        type: "object",
        properties: {
          resourceId: { type: "string", description: "Parent resource ID" },
          name: { type: "string", description: "Service name." },
          description: { type: "string", description: "Optional description." },
          isActive: {
            type: "boolean",
            description: "Whether the check runs. Defaults to true.",
          },
          isPublic: {
            type: "boolean",
            description:
              "Whether it appears on the public status page. Defaults to false.",
          },
          check: CHECK_PROPERTY,
        },
        required: ["resourceId", "name", "check"],
      },
    },
    isWrite: true,
    category: "resources",
    execute: async (input) => {
      const resourceId = requireObjectId(input.resourceId, "resourceId");
      const check = parseSubResourceCheck(input.check);
      const SubResource = await getSubResourceModel();
      const created = await SubResource.create({
        parentResourceId: resourceId,
        name: String(input.name),
        description:
          typeof input.description === "string" ? input.description : undefined,
        isActive: input.isActive !== false,
        isPublic: input.isPublic === true,
        check,
      });
      return serializeSubResource(created.toObject());
    },
  },
  {
    schema: {
      name: "update_sub_resource",
      description:
        "Update a service under a resource. Only the fields you pass are changed.",
      input_schema: {
        type: "object",
        properties: {
          subResourceId: { type: "string", description: "Sub-resource ID" },
          name: { type: "string", description: "Service name." },
          description: { type: "string", description: "Description." },
          isActive: {
            type: "boolean",
            description: "Whether the check runs.",
          },
          isPublic: {
            type: "boolean",
            description: "Whether it appears on the public status page.",
          },
          check: CHECK_PROPERTY,
        },
        required: ["subResourceId"],
      },
    },
    isWrite: true,
    category: "resources",
    execute: async (input) => {
      const id = requireObjectId(input.subResourceId, "subResourceId");
      const update: Record<string, unknown> = {};
      if (typeof input.name === "string") update.name = input.name;
      if (typeof input.description === "string") {
        update.description = input.description;
      }
      if (typeof input.isActive === "boolean") update.isActive = input.isActive;
      if (typeof input.isPublic === "boolean") update.isPublic = input.isPublic;
      if (input.check !== undefined) {
        update.check = parseSubResourceCheck(input.check);
      }
      const SubResource = await getSubResourceModel();
      const updated = await SubResource.findByIdAndUpdate(id, update, {
        returnDocument: "after",
        runValidators: true,
      }).lean();
      if (!updated) throw new Error("Sub-resource not found");
      return serializeSubResource(updated);
    },
  },
  {
    schema: {
      name: "delete_sub_resource",
      description:
        "Delete a service under a resource along with its health-check logs.",
      input_schema: {
        type: "object",
        properties: {
          subResourceId: { type: "string", description: "Sub-resource ID" },
        },
        required: ["subResourceId"],
      },
    },
    isWrite: true,
    category: "resources",
    execute: async (input) => {
      const id = requireObjectId(input.subResourceId, "subResourceId");
      const SubResource = await getSubResourceModel();
      const deleted = await SubResource.findByIdAndDelete(id).lean();
      if (!deleted) throw new Error("Sub-resource not found");
      const HealthCheckLog = await getHealthCheckLogModel();
      await HealthCheckLog.deleteMany({ resourceId: deleted._id });
      return { deleted: true, name: deleted.name };
    },
  },
];
