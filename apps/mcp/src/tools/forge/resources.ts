import type { McpServer } from "@modelcontextprotocol/server";
import {
  connectResourceInputSchema,
  createDeployDomainInputSchema,
  createResourceInputSchema,
  metricsQuerySchema,
  resourceListQuerySchema,
  updateDeployDomainInputSchema,
} from "@repo/schemas/cloud";
import { z } from "zod";
import { type Api, defineTool, p, uuid } from "../define";

const targetId = uuid.describe("Deploy target id");
const resourceId = uuid.describe("Resource id");
const domainId = uuid.describe("Domain id");

export function registerForgeResources(server: McpServer, api: Api) {
  defineTool(server, {
    name: "forge_resources_list",
    title: "Forge: resources",
    description:
      "Managed Postgres/Mongo/Redis/S3 resources, filterable by kind, text and whether connected to nothing.",
    input: z.object(resourceListQuerySchema.shape),
    annotations: { readOnlyHint: true },
    run: (query) => api.cloud.get("/api/deploy/resources", query),
  });

  defineTool(server, {
    name: "forge_resource_get",
    title: "Forge: resource",
    description: "One resource with its connections and the env each injects.",
    input: z.object({ resourceId }),
    annotations: { readOnlyHint: true },
    run: ({ resourceId }) =>
      api.cloud.get(p`/api/deploy/resources/${resourceId}`),
  });

  defineTool(server, {
    name: "forge_resource_create",
    title: "Forge: create resource",
    description:
      "Provisions a resource; with projectId it is connected to that project in the same transaction.",
    input: z.object(createResourceInputSchema.shape),
    run: (body) => api.cloud.post("/api/deploy/resources", body),
  });

  defineTool(server, {
    name: "forge_resource_delete",
    title: "Forge: delete resource",
    description: "Drops the resource and its data. Connections go with it.",
    input: z.object({ resourceId }),
    annotations: { destructiveHint: true },
    run: ({ resourceId }) =>
      api.cloud.delete(p`/api/deploy/resources/${resourceId}`),
  });

  defineTool(server, {
    name: "forge_resource_credentials_reveal",
    title: "Forge: reveal resource credentials",
    description: "Returns the resource's plaintext connection credentials.",
    input: z.object({ resourceId }),
    annotations: { destructiveHint: true },
    run: ({ resourceId }) =>
      api.cloud.post(p`/api/deploy/resources/${resourceId}/credentials`),
  });

  defineTool(server, {
    name: "forge_resource_connect",
    title: "Forge: connect resource",
    description:
      "Connects a resource to a project with a scope (all, production or preview) and env prefix.",
    input: z.object({ resourceId, ...connectResourceInputSchema.shape }),
    run: ({ resourceId, ...body }) =>
      api.cloud.post(p`/api/deploy/resources/${resourceId}/connections`, body),
  });

  defineTool(server, {
    name: "forge_resource_disconnect",
    title: "Forge: disconnect resource",
    description: "Removes a connection. The resource and its data stay.",
    input: z.object({ resourceId, connectionId: uuid }),
    annotations: { destructiveHint: true, idempotentHint: true },
    run: ({ resourceId, connectionId }) =>
      api.cloud.delete(
        p`/api/deploy/resources/${resourceId}/connections/${connectionId}`,
      ),
  });

  defineTool(server, {
    name: "forge_target_resources",
    title: "Forge: resources of a target",
    description:
      "Every resource connected to a target's project and the env vars each injects.",
    input: z.object({ targetId }),
    annotations: { readOnlyHint: true },
    run: ({ targetId }) =>
      api.cloud.get(p`/api/deploy/targets/${targetId}/resources`),
  });

  // Domains ----------------------------------------------------------------

  defineTool(server, {
    name: "forge_domains_list",
    title: "Forge: domains",
    description: "Custom domains of a target (production only carries them).",
    input: z.object({ targetId }),
    annotations: { readOnlyHint: true },
    run: ({ targetId }) =>
      api.cloud.get(p`/api/deploy/targets/${targetId}/domains`),
  });

  defineTool(server, {
    name: "forge_domain_create",
    title: "Forge: add domain",
    description:
      "Adds a hostname as a zone record or a Cloudflare custom hostname; returns the verification records.",
    input: z.object({ targetId, ...createDeployDomainInputSchema.shape }),
    run: ({ targetId, ...body }) =>
      api.cloud.post(p`/api/deploy/targets/${targetId}/domains`, body),
  });

  defineTool(server, {
    name: "forge_domain_update",
    title: "Forge: update domain",
    description: "Hostname, primary flag or redirect target of a domain.",
    input: z.object({ domainId, ...updateDeployDomainInputSchema.shape }),
    annotations: { idempotentHint: true },
    run: ({ domainId, ...body }) =>
      api.cloud.patch(p`/api/deploy/domains/${domainId}`, body),
  });

  defineTool(server, {
    name: "forge_domain_delete",
    title: "Forge: delete domain",
    description: "Removes the domain and its DNS/custom-hostname records.",
    input: z.object({ domainId }),
    annotations: { destructiveHint: true },
    run: ({ domainId }) => api.cloud.delete(p`/api/deploy/domains/${domainId}`),
  });

  defineTool(server, {
    name: "forge_domain_verify",
    title: "Forge: verify domain",
    description:
      "Re-checks ownership and SSL status now instead of waiting for the nightly task.",
    input: z.object({ domainId }),
    annotations: { idempotentHint: true },
    run: ({ domainId }) =>
      api.cloud.post(p`/api/deploy/domains/${domainId}/verify`),
  });

  // Host -------------------------------------------------------------------

  defineTool(server, {
    name: "forge_overview",
    title: "Forge: overview",
    description:
      "Host snapshot: containers, images, memory, disk, agent queue and health.",
    input: z.object({}),
    annotations: { readOnlyHint: true },
    run: () => api.cloud.get("/api/forge/overview"),
  });

  defineTool(server, {
    name: "forge_host_series",
    title: "Forge: available host series",
    description: "Metric series names the Forge host has samples for.",
    input: z.object({}),
    annotations: { readOnlyHint: true },
    run: () => api.cloud.get("/api/forge/series"),
  });

  const metricsInput = z.object({
    series: metricsQuerySchema.shape.series,
    from: metricsQuerySchema.shape.from
      .optional()
      .describe("ISO; default 1h ago"),
    to: metricsQuerySchema.shape.to.optional().describe("ISO; default now"),
    step: metricsQuerySchema.shape.step.optional().describe("Seconds"),
  });

  defineTool(server, {
    name: "forge_host_metrics",
    title: "Forge: host metrics",
    description:
      "Time series of the Forge host (names from forge_host_series).",
    input: metricsInput,
    annotations: { readOnlyHint: true },
    run: ({ series, ...query }) =>
      api.cloud.get("/api/forge/metrics", {
        ...query,
        series: series.join(","),
      }),
  });

  defineTool(server, {
    name: "forge_project_metrics",
    title: "Forge: project metrics",
    description:
      "A project's request/container history across its deployments, optionally one kind or deployment.",
    input: z.object({
      slug: z.string().min(1),
      metrics: z
        .array(z.string())
        .optional()
        .describe("Default: every project metric"),
      kind: z.enum(["production", "environment", "preview"]).optional(),
      deploymentId: uuid.optional(),
      from: metricsQuerySchema.shape.from.optional(),
      to: metricsQuerySchema.shape.to.optional(),
      step: metricsQuerySchema.shape.step
        .optional()
        .describe("Seconds, default 300"),
    }),
    annotations: { readOnlyHint: true },
    run: ({ slug, metrics, deploymentId, ...query }) =>
      api.cloud.get(p`/api/forge/projects/${slug}/metrics`, {
        ...query,
        metrics: metrics?.join(","),
        deployment: deploymentId,
      }),
  });
}
