import type { McpServer } from "@modelcontextprotocol/server";
import { piCronJobInputSchema } from "@repo/schemas";
import { z } from "zod";
import { type Api, action, defineActions, p, partial } from "../define";

const id = z.string().min(1).describe("Resource _id");
const byId = z.object({ id });
const capId = z.string().min(1).describe("Capability _id");
const jobId = z.string().min(1).describe("PiCron job id");
const subId = z.string().min(1).describe("Sub-resource _id");

const agentService = z.object({
  enabled: z.boolean().optional(),
  nodeId: z.string().optional(),
  hmacSecret: z
    .string()
    .nullable()
    .optional()
    .describe("Plaintext; encrypted at rest, blank keeps the current one"),
});

const resourceFields = {
  name: z.string().min(1),
  url: z.string().min(1),
  type: z.enum(["pi", "vps", "api", "service"]),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
  isPublic: z.boolean().optional(),
  agentService: agentService.optional(),
};

const subResourceCheck = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("http"),
    url: z.string().min(1),
    expectStatus: z.number().nullable().optional(),
    expectJsonPath: z.string().nullable().optional(),
    expectEquals: z.string().nullable().optional(),
  }),
  z.object({
    type: z.literal("tcp"),
    host: z.string().min(1),
    port: z.number().int(),
  }),
]);

const subResourceFields = {
  name: z.string().min(1),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
  isPublic: z.boolean().optional(),
  check: subResourceCheck,
};

export function registerWebResources(server: McpServer, api: Api) {
  defineActions(server, {
    name: "web_resources",
    title: "Web: monitored resources",
    description: "Hosts and services under uptime monitoring.",
    actions: {
      list: action({
        description: "Every resource with live agent state and uptime",
        readOnly: true,
        run: () => api.web.get("/api/admin/resources"),
      }),
      get: action({
        description: "One resource",
        input: byId,
        readOnly: true,
        run: ({ id }) => api.web.get(p`/api/admin/resources/${id}`),
      }),
      create: action({
        description: "Adds a resource (name, url, type required)",
        input: z.object(resourceFields),
        run: (body) => api.web.post("/api/admin/resources", body),
      }),
      update: action({
        description: "Changes any field",
        input: z.object({ id, ...partial(resourceFields) }),
        idempotent: true,
        run: ({ id, ...body }) =>
          api.web.patch(p`/api/admin/resources/${id}`, body),
      }),
      delete: action({
        description: "Deletes a resource",
        input: byId,
        destructive: true,
        run: ({ id }) => api.web.delete(p`/api/admin/resources/${id}`),
      }),
      reboot: action({
        description: "Reboots the host through its agent",
        input: byId,
        destructive: true,
        run: ({ id }) => api.web.post(p`/api/admin/resources/${id}/reboot`),
      }),
      health_check: action({
        description: "Runs every health check now",
        run: () => api.web.post("/api/admin/resources/health-check"),
      }),
    },
  });

  defineActions(server, {
    name: "web_resource_services",
    title: "Web: resource services",
    description: "Systemd services reported by a resource's agent.",
    actions: {
      list: action({
        description: "Services on the host",
        input: byId,
        readOnly: true,
        run: ({ id }) => api.web.get(p`/api/admin/resources/${id}/services`),
      }),
      restart: action({
        description: "Restarts one monitored service",
        input: z.object({ id, serviceName: z.string().min(1) }),
        run: ({ id, serviceName }) =>
          api.web.post(p`/api/admin/resources/${id}/services`, {
            serviceName,
          }),
      }),
    },
  });

  defineActions(server, {
    name: "web_resource_capabilities",
    title: "Web: resource capabilities",
    description: "Capabilities attached to a resource (e.g. picron).",
    actions: {
      create: action({
        description:
          "Adds a capability; picron needs username and password, others take config",
        input: z.object({
          id,
          type: z.string().min(1),
          label: z.string().min(1),
          baseUrl: z.string().min(1),
          isActive: z.boolean().optional(),
          username: z.string().optional(),
          password: z.string().optional(),
          config: z.record(z.string(), z.unknown()).optional(),
        }),
        run: ({ id, ...body }) =>
          api.web.post(p`/api/admin/resources/${id}/capabilities`, body),
      }),
      update: action({
        description: "Changes label, isActive, credentials or config",
        input: z.object({
          id,
          capId,
          label: z.string().optional(),
          isActive: z.boolean().optional(),
          username: z.string().optional(),
          password: z.string().optional(),
          config: z.record(z.string(), z.unknown()).optional(),
        }),
        idempotent: true,
        run: ({ id, capId, ...body }) =>
          api.web.patch(
            p`/api/admin/resources/${id}/capabilities/${capId}`,
            body,
          ),
      }),
      delete: action({
        description: "Removes a capability",
        input: z.object({ id, capId }),
        destructive: true,
        run: ({ id, capId }) =>
          api.web.delete(p`/api/admin/resources/${id}/capabilities/${capId}`),
      }),
    },
  });

  const picron = (id: string, capId: string) =>
    p`/api/admin/resources/${id}/capabilities/${capId}/picron`;
  const job = (id: string, capId: string, jobId: string) =>
    p`/api/admin/resources/${id}/capabilities/${capId}/picron/jobs/${jobId}`;
  defineActions(server, {
    name: "web_picron_jobs",
    title: "Web: PiCron jobs",
    description: "Cron jobs on a resource's picron capability.",
    actions: {
      list: action({
        description: "Every job",
        input: z.object({ id, capId }),
        readOnly: true,
        run: ({ id, capId }) => api.web.get(`${picron(id, capId)}/jobs`),
      }),
      create: action({
        description: "Adds a job",
        input: z.object({ id, capId, ...piCronJobInputSchema.shape }),
        run: ({ id, capId, ...body }) =>
          api.web.post(`${picron(id, capId)}/jobs`, body),
      }),
      update: action({
        description: "Changes any field of a job",
        input: z.object({
          id,
          capId,
          jobId,
          ...partial(piCronJobInputSchema.shape),
        }),
        idempotent: true,
        run: ({ id, capId, jobId, ...body }) =>
          api.web.put(job(id, capId, jobId), body),
      }),
      delete: action({
        description: "Deletes a job",
        input: z.object({ id, capId, jobId }),
        destructive: true,
        run: ({ id, capId, jobId }) => api.web.delete(job(id, capId, jobId)),
      }),
      trigger: action({
        description: "Runs a job now",
        input: z.object({ id, capId, jobId }),
        run: ({ id, capId, jobId }) =>
          api.web.post(`${job(id, capId, jobId)}/trigger`),
      }),
      history: action({
        description: "Execution history of a job",
        input: z.object({ id, capId, jobId }),
        readOnly: true,
        run: ({ id, capId, jobId }) =>
          api.web.get(`${job(id, capId, jobId)}/history`),
      }),
      stats: action({
        description: "Job and execution counts",
        input: z.object({ id, capId }),
        readOnly: true,
        run: ({ id, capId }) => api.web.get(`${picron(id, capId)}/stats`),
      }),
    },
  });

  defineActions(server, {
    name: "web_sub_resources",
    title: "Web: sub-resources",
    description: "Services checked under a parent resource (http or tcp).",
    actions: {
      list: action({
        description: "Sub-resources of a resource with uptime",
        input: byId,
        readOnly: true,
        run: ({ id }) =>
          api.web.get(p`/api/admin/resources/${id}/sub-resources`),
      }),
      create: action({
        description: "Adds a sub-resource (name and check required)",
        input: z.object({ id, ...subResourceFields }),
        run: ({ id, ...body }) =>
          api.web.post(p`/api/admin/resources/${id}/sub-resources`, body),
      }),
      update: action({
        description: "Changes any field",
        input: z.object({ id, subId, ...partial(subResourceFields) }),
        idempotent: true,
        run: ({ id, subId, ...body }) =>
          api.web.patch(
            p`/api/admin/resources/${id}/sub-resources/${subId}`,
            body,
          ),
      }),
      delete: action({
        description: "Deletes a sub-resource and its health logs",
        input: z.object({ id, subId }),
        destructive: true,
        run: ({ id, subId }) =>
          api.web.delete(p`/api/admin/resources/${id}/sub-resources/${subId}`),
      }),
    },
  });
}
