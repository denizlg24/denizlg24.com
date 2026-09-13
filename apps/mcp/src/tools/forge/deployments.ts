import type { McpServer } from "@modelcontextprotocol/server";
import {
  createDeploymentInputSchema,
  forgeDeploymentQuerySchema,
  forgePreviewShareInputSchema,
  forgeRequestLogQuerySchema,
  forgeRequestLogsQuerySchema,
} from "@repo/schemas/cloud";
import { z } from "zod";
import {
  type Api,
  action,
  collectStream,
  defineActions,
  defineTool,
  fail,
  limit,
  ok,
  p,
  page,
  uuid,
} from "../define";
import { withCommitSubjects } from "./commits";

const targetId = uuid.describe("Deploy target id");
const deploymentId = uuid.describe("Deployment id");

const LOG_MAX_BYTES = 512 * 1024;

const logWindow = {
  maxMs: z
    .number()
    .int()
    .min(500)
    .max(60_000)
    .default(4_000)
    .describe("How long to read a live stream before returning"),
};

export function registerForgeDeployments(server: McpServer, api: Api) {
  defineTool(server, {
    name: "forge_deployments_list",
    title: "Forge: deployments of a target",
    description:
      "Deployments of one target, newest first. Commit messages are subject lines.",
    input: z.object({ targetId, page, limit }),
    annotations: { readOnlyHint: true },
    run: async ({ targetId, page, limit }) =>
      withCommitSubjects(
        await api.cloud.get(p`/api/deploy/targets/${targetId}/deployments`, {
          page,
          limit,
        }),
      ),
  });

  defineTool(server, {
    name: "forge_deployments_search",
    title: "Forge: search deployments",
    description:
      "Cross-target deployment feed with status, kind, branch, repo, project, text and time filters. Commit messages are subject lines.",
    input: z.object(forgeDeploymentQuerySchema.shape),
    annotations: { readOnlyHint: true },
    run: async (query) =>
      withCommitSubjects(await api.cloud.get("/api/forge/deployments", query)),
  });

  defineTool(server, {
    name: "forge_target_branches",
    title: "Forge: branches with deployments",
    description:
      "Branches a target currently has deployments for, latest each. Commit messages are subject lines.",
    input: z.object({ targetId, limit }),
    annotations: { readOnlyHint: true },
    run: async ({ targetId, limit }) =>
      withCommitSubjects(
        await api.cloud.get(p`/api/deploy/targets/${targetId}/branches`, {
          limit,
        }),
      ),
  });

  defineTool(server, {
    name: "forge_resolve_ref",
    title: "Forge: resolve ref",
    description:
      "What a branch, tag, sha, PR or HEAD resolves to for a target, before anything is queued.",
    input: z.object({ targetId, ref: z.string().min(1) }),
    annotations: { readOnlyHint: true },
    run: ({ targetId, ref }) =>
      api.cloud.get(p`/api/deploy/targets/${targetId}/resolve-ref`, { ref }),
  });

  defineTool(server, {
    name: "forge_deployment_create",
    title: "Forge: deploy",
    description:
      "Queues a deployment of a ref. The slot (production, environment, preview) is derived from the branch; kind is ignored.",
    input: z.object({ targetId, ...createDeploymentInputSchema.shape }),
    run: ({ targetId, ...body }) =>
      api.cloud.post(p`/api/deploy/targets/${targetId}/deployments`, body),
  });

  defineTool(server, {
    name: "forge_deployment_get",
    title: "Forge: deployment",
    description:
      "One deployment row: status, phase, commit, hostname, container.",
    input: z.object({ deploymentId }),
    annotations: { readOnlyHint: true },
    run: ({ deploymentId }) =>
      api.cloud.get(p`/api/deploy/deployments/${deploymentId}`),
  });

  defineTool(server, {
    name: "forge_deployment_summary",
    title: "Forge: deployment summary",
    description:
      "The Forge dashboard's view of a deployment: container state, live metrics, request stats.",
    input: z.object({ deploymentId }),
    annotations: { readOnlyHint: true },
    run: ({ deploymentId }) =>
      api.cloud.get(p`/api/forge/deployments/${deploymentId}`),
  });

  async function readLog(path: string, maxMs: number) {
    const controller = new AbortController();
    let response: Response;
    try {
      response = await api.cloud.raw("GET", path, {
        signal: controller.signal,
      });
    } catch (error) {
      return fail(null, error instanceof Error ? error.message : String(error));
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return fail(response.status, body.slice(0, 2_000));
    }
    const collected = await collectStream(response, {
      maxMs,
      maxBytes: LOG_MAX_BYTES,
      controller,
    });
    return ok(collected);
  }

  defineTool(server, {
    name: "forge_deployment_build_logs",
    title: "Forge: build logs",
    description:
      "Build log lines. A finished build returns complete=true; a running one returns what arrived within maxMs.",
    input: z.object({ deploymentId, ...logWindow }),
    annotations: { readOnlyHint: true },
    run: ({ deploymentId, maxMs }) =>
      readLog(p`/api/deploy/deployments/${deploymentId}/logs`, maxMs),
  });

  defineTool(server, {
    name: "forge_deployment_runtime_logs",
    title: "Forge: runtime logs",
    description:
      "Last 500 stdout/stderr lines of the deployment's container plus whatever arrives within maxMs.",
    input: z.object({ deploymentId, ...logWindow }),
    annotations: { readOnlyHint: true },
    run: ({ deploymentId, maxMs }) =>
      readLog(p`/api/deploy/deployments/${deploymentId}/runtime-logs`, maxMs),
  });

  defineTool(server, {
    name: "forge_container_logs",
    title: "Forge: container logs",
    description: "Same as runtime logs, addressed by Docker container id.",
    input: z.object({ containerId: z.string().min(1), ...logWindow }),
    annotations: { readOnlyHint: true },
    run: ({ containerId, maxMs }) =>
      readLog(p`/api/forge/containers/${containerId}/logs`, maxMs),
  });

  const byId = z.object({ deploymentId });
  defineActions(server, {
    name: "forge_deployment_action",
    title: "Forge: deployment action",
    description: "State transitions on one deployment.",
    actions: {
      cancel: action({
        description: "Stops a queued or building deployment",
        input: byId,
        run: ({ deploymentId }) =>
          api.cloud.post(p`/api/deploy/deployments/${deploymentId}/cancel`),
      }),
      retry: action({
        description: "Builds the same commit again, keeping its slot",
        input: byId,
        run: ({ deploymentId }) =>
          api.cloud.post(p`/api/deploy/deployments/${deploymentId}/retry`),
      }),
      rollback: action({
        description: "Rebuilds this deployment's commit as production",
        input: byId,
        destructive: true,
        run: ({ deploymentId }) =>
          api.cloud.post(p`/api/deploy/deployments/${deploymentId}/rollback`),
      }),
      promote: action({
        description:
          "Makes a preview or environment deployment production without rebuilding",
        input: byId,
        destructive: true,
        run: ({ deploymentId }) =>
          api.cloud.post(p`/api/deploy/deployments/${deploymentId}/promote`),
      }),
      restart: action({
        description: "docker restart of the container",
        input: byId,
        run: ({ deploymentId }) =>
          api.cloud.post(p`/api/deploy/deployments/${deploymentId}/restart`),
      }),
      delete: action({
        description: "Tears the container down and removes the row",
        input: byId,
        destructive: true,
        run: ({ deploymentId }) =>
          api.cloud.delete(p`/api/deploy/deployments/${deploymentId}`),
      }),
    },
  });

  defineTool(server, {
    name: "forge_deployment_share",
    title: "Forge: share preview",
    description:
      "Mints a link that opens a gated preview/environment without signing in.",
    input: z.object({ deploymentId, ...forgePreviewShareInputSchema.shape }),
    run: ({ deploymentId, ...body }) =>
      api.cloud.post(p`/api/forge/deployments/${deploymentId}/share`, body),
  });

  defineTool(server, {
    name: "forge_deployment_requests",
    title: "Forge: request stats",
    description:
      "Recent requests to a deployment with method/status/duration filters.",
    input: z.object({ deploymentId, ...forgeRequestLogQuerySchema.shape }),
    annotations: { readOnlyHint: true },
    run: ({ deploymentId, ...query }) =>
      api.cloud.get(p`/api/forge/deployments/${deploymentId}/requests`, query),
  });

  defineTool(server, {
    name: "forge_deployment_request_logs",
    title: "Forge: request logs",
    description:
      "Access log lines of a deployment in a time window, optionally one requestId.",
    input: z.object({ deploymentId, ...forgeRequestLogsQuerySchema.shape }),
    annotations: { readOnlyHint: true },
    run: ({ deploymentId, ...query }) =>
      api.cloud.get(
        p`/api/forge/deployments/${deploymentId}/request-logs`,
        query,
      ),
  });
}
