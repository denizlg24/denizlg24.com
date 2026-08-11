import type {
  ConnectableProject,
  ConnectResourceInput,
  CreateDeployDomainInput,
  CreateDeploymentInput,
  CreateDeployTargetRequest,
  CreatedResource,
  CreateResourceInput,
  DeployBindings,
  DeployBranch,
  DeployCapacity,
  DeployDomain,
  DeployEnvVar,
  Deployment,
  DeployTarget,
  DeployTargetListEntry,
  DetectBuildResponse,
  GithubConnection,
  GithubInstallationSummary,
  GithubRepositorySummary,
  LinkEnvoyProjectInput,
  ProjectResource,
  ReplaceDeployEnvInput,
  RepoBadge,
  Resource,
  ResourceConnection,
  ResourceCredentials,
  ResourceDetail,
  ResourceListQuery,
  UpdateDeployDomainInput,
  UpdateDeployTargetInput,
} from "@repo/schemas/cloud";
import {
  connectableProjectListSchema,
  createdResourceSchema,
  deployBindingsSchema,
  deployBranchSchema,
  deployCapacitySchema,
  deployDomainSchema,
  deployEnvVarSchema,
  deploymentKindSchema,
  deploymentSchema,
  deployTargetListEntrySchema,
  deployTargetSchema,
  detectBuildResponseSchema,
  githubBranchSchema,
  githubConnectionSchema,
  githubInstallationSummarySchema,
  githubRepositorySchema,
  githubTreeEntrySchema,
  projectResourceListSchema,
  repoBadgeSchema,
  resourceConnectionSchema,
  resourceCredentialsSchema,
  resourceDetailSchema,
  resourceListSchema,
} from "@repo/schemas/cloud";
import { z } from "zod";
import {
  APPLY_ENV_TIMEOUT_MS,
  buildUrl,
  type Paginated,
  rawRequest,
  requestData,
  requestPaginated,
  SLOW_TIMEOUT_MS,
} from "../api-client";

export const deployApplyEnvReportSchema = z.object({
  applied: z.number().int().min(0),
  results: z.array(
    z.object({
      deploymentId: z.uuid(),
      kind: deploymentKindSchema,
      hostname: z.string(),
      recreated: z.boolean(),
      healthy: z.boolean(),
      rolledBack: z.boolean(),
      error: z.string().nullable(),
    }),
  ),
});
export type DeployApplyEnvReport = z.infer<typeof deployApplyEnvReportSchema>;

export const deployApi = {
  capacity: (): Promise<DeployCapacity> =>
    requestData(deployCapacitySchema, "/api/deploy/capacity"),
  github: {
    connection: (): Promise<GithubConnection> =>
      requestData(githubConnectionSchema, "/api/deploy/github/connection"),
    syncInstallations: (): Promise<GithubInstallationSummary[]> =>
      requestData(
        z.array(githubInstallationSummarySchema),
        "/api/deploy/github/installations/sync",
        // One GitHub call for the installation list, then one per
        // installation for its repositories.
        { method: "POST", timeoutMs: SLOW_TIMEOUT_MS },
      ),
    repositories: (): Promise<GithubRepositorySummary[]> =>
      requestData(
        z.array(githubRepositorySchema),
        "/api/deploy/github/repositories",
        // Fans out to one GitHub call per installation, each paginated.
        { timeoutMs: SLOW_TIMEOUT_MS },
      ),
    branches: (
      owner: string,
      repo: string,
    ): Promise<{ name: string; sha: string }[]> =>
      requestData(
        z.array(githubBranchSchema),
        `/api/deploy/github/repos/${owner}/${repo}/branches`,
      ),
    tree: (
      owner: string,
      repo: string,
      query: { ref?: string; path?: string },
    ): Promise<{ path: string; name: string; type: "file" | "dir" }[]> =>
      requestData(
        z.array(githubTreeEntrySchema),
        `/api/deploy/github/repos/${owner}/${repo}/tree`,
        { query },
      ),
    detect: (
      owner: string,
      repo: string,
      query: { ref?: string; dir?: string; framework?: string },
    ): Promise<DetectBuildResponse> =>
      requestData(
        detectBuildResponseSchema,
        `/api/deploy/github/repos/${owner}/${repo}/detect`,
        { query, timeoutMs: SLOW_TIMEOUT_MS },
      ),
    badges: (repos: { owner: string; name: string }[]): Promise<RepoBadge[]> =>
      requestData(z.array(repoBadgeSchema), "/api/deploy/github/repos/badges", {
        method: "POST",
        body: { repos },
        // One Contents call per repository, run concurrently.
        timeoutMs: SLOW_TIMEOUT_MS,
      }),
  },

  targets: (): Promise<DeployTargetListEntry[]> =>
    requestData(z.array(deployTargetListEntrySchema), "/api/deploy/targets"),
  target: (id: string): Promise<DeployTarget> =>
    requestData(deployTargetSchema, `/api/deploy/targets/${id}`),
  /**
   * Forge addresses a deployable by its project slug, which is what its URLs
   * carry; nothing in its routes ever holds a target id to look one up with.
   */
  targetBySlug: (slug: string): Promise<DeployTarget> =>
    requestData(
      deployTargetSchema,
      `/api/deploy/projects/${encodeURIComponent(slug)}/target`,
    ),
  /**
   * A 201 with a `warning` means the project exists but its first deployment
   * was not queued — most plausibly no capacity left. The project page would
   * otherwise just sit empty with nothing saying why, so the caller has to
   * surface it.
   */
  createTarget: (
    input: CreateDeployTargetRequest,
  ): Promise<{ target: DeployTarget; warning: string | null }> =>
    rawRequest("/api/deploy/targets", {
      method: "POST",
      body: input,
      // Creating a target provisions a DNS record on Cloudflare, may provision
      // the project it belongs to first, and then queues the first build.
      timeoutMs: SLOW_TIMEOUT_MS,
    }).then((payload) => {
      const parsed = z
        .object({ data: deployTargetSchema, warning: z.string().optional() })
        .parse(payload);
      return { target: parsed.data, warning: parsed.warning ?? null };
    }),
  updateTarget: (
    id: string,
    input: UpdateDeployTargetInput,
  ): Promise<DeployTarget> =>
    requestData(deployTargetSchema, `/api/deploy/targets/${id}`, {
      method: "PATCH",
      body: input,
    }),
  removeTarget: (id: string): Promise<{ id: string }> =>
    requestData(z.object({ id: z.uuid() }), `/api/deploy/targets/${id}`, {
      method: "DELETE",
      // Tears down every container and record the target owns.
      timeoutMs: SLOW_TIMEOUT_MS,
    }),

  deployments: (
    targetId: string,
    query?: { page?: number; limit?: number },
  ): Promise<Paginated<Deployment>> =>
    requestPaginated(
      deploymentSchema,
      `/api/deploy/targets/${targetId}/deployments`,
      { query },
    ),
  deployment: (id: string): Promise<Deployment> =>
    requestData(deploymentSchema, `/api/deploy/deployments/${id}`),
  branches: (
    targetId: string,
    query?: { limit?: number },
  ): Promise<DeployBranch[]> =>
    requestData(
      z.array(deployBranchSchema),
      `/api/deploy/targets/${targetId}/branches`,
      { query },
    ),

  /** Every project, including the ones that hold a resource and nothing else. */
  projects: (): Promise<ConnectableProject[]> =>
    requestData(connectableProjectListSchema, "/api/deploy/projects").then(
      (page) => page.projects,
    ),
  /** Every resource on the box, whether or not anything connects to it. */
  resources: (query?: Partial<ResourceListQuery>): Promise<Resource[]> =>
    requestData(resourceListSchema, "/api/deploy/resources", {
      query: {
        kind: query?.kind ?? undefined,
        search: query?.search ?? undefined,
        unconnected: query?.unconnected ? "true" : undefined,
      },
    }).then((page) => page.resources),
  resource: (id: string): Promise<ResourceDetail> =>
    requestData(resourceDetailSchema, `/api/deploy/resources/${id}`),
  /**
   * POST because revealing a credential is an act rather than a view — it keeps
   * the secret out of browser history and off a prefetchable URL.
   */
  resourceCredentials: (id: string): Promise<ResourceCredentials> =>
    requestData(
      resourceCredentialsSchema,
      `/api/deploy/resources/${id}/credentials`,
      { method: "POST" },
    ),
  /** What one project has connected, and what each connection injects. */
  targetResources: (targetId: string): Promise<ProjectResource[]> =>
    requestData(
      projectResourceListSchema,
      `/api/deploy/targets/${targetId}/resources`,
    ).then((page) => page.resources),
  /**
   * Creates a resource, connecting it in the same transaction when `projectId`
   * is set. The password comes back once and only here.
   */
  createResource: (input: CreateResourceInput): Promise<CreatedResource> =>
    requestData(createdResourceSchema, "/api/deploy/resources", {
      method: "POST",
      body: input,
      // Provisions a database, a role and a password on the engine.
      timeoutMs: SLOW_TIMEOUT_MS,
    }),
  /** Refuses while anything is still connected. Disconnect first. */
  removeResource: (id: string): Promise<{ id: string }> =>
    requestData(z.object({ id: z.uuid() }), `/api/deploy/resources/${id}`, {
      method: "DELETE",
      // Drops the database off its engine.
      timeoutMs: SLOW_TIMEOUT_MS,
    }),
  connectResource: (
    id: string,
    input: ConnectResourceInput,
  ): Promise<ResourceConnection> =>
    requestData(
      resourceConnectionSchema,
      `/api/deploy/resources/${id}/connections`,
      { method: "POST", body: input },
    ),
  /** Stops the project's bindings resolving through it. Destroys nothing. */
  disconnectResource: (
    id: string,
    connectionId: string,
  ): Promise<{ id: string }> =>
    requestData(
      z.object({ id: z.uuid() }),
      `/api/deploy/resources/${id}/connections/${connectionId}`,
      { method: "DELETE" },
    ),
  create: (
    targetId: string,
    input: CreateDeploymentInput,
  ): Promise<Deployment> =>
    requestData(
      deploymentSchema,
      `/api/deploy/targets/${targetId}/deployments`,
      {
        method: "POST",
        body: input,
        timeoutMs: SLOW_TIMEOUT_MS,
      },
    ),
  cancel: (id: string): Promise<unknown> =>
    requestData(z.unknown(), `/api/deploy/deployments/${id}/cancel`, {
      method: "POST",
    }),
  retry: (id: string): Promise<Deployment> =>
    requestData(deploymentSchema, `/api/deploy/deployments/${id}/retry`, {
      method: "POST",
      timeoutMs: SLOW_TIMEOUT_MS,
    }),
  rollback: (id: string): Promise<Deployment> =>
    requestData(deploymentSchema, `/api/deploy/deployments/${id}/rollback`, {
      method: "POST",
      timeoutMs: SLOW_TIMEOUT_MS,
    }),
  restart: (
    id: string,
  ): Promise<{ restarted: boolean; healthy: boolean | null }> =>
    requestData(
      z.object({
        restarted: z.boolean(),
        healthy: z.boolean().nullable(),
        error: z.string().nullable(),
      }),
      `/api/deploy/deployments/${id}/restart`,
      { method: "POST", timeoutMs: SLOW_TIMEOUT_MS },
    ),
  remove: (id: string): Promise<{ id: string }> =>
    requestData(z.object({ id: z.uuid() }), `/api/deploy/deployments/${id}`, {
      method: "DELETE",
    }),
  /**
   * 202 with a `warning` means the row says production and the agent did not
   * confirm the route change — a half-promoted deployment that looks fine
   * everywhere else, so the caller has to surface it.
   */
  promote: (
    id: string,
  ): Promise<{ deployment: Deployment; warning: string | null }> =>
    rawRequest(`/api/deploy/deployments/${id}/promote`, {
      method: "POST",
      timeoutMs: SLOW_TIMEOUT_MS,
    }).then((payload) => {
      const parsed = z
        .object({ data: deploymentSchema, warning: z.string().optional() })
        .parse(payload);
      return { deployment: parsed.data, warning: parsed.warning ?? null };
    }),
  logsUrl: (id: string): string =>
    buildUrl(`/api/deploy/deployments/${id}/logs`, undefined).toString(),
  runtimeLogsUrl: (id: string): string =>
    buildUrl(
      `/api/deploy/deployments/${id}/runtime-logs`,
      undefined,
    ).toString(),

  /** Opt in to pulling env from Envoy. Sends a passphrase; nothing reads it back. */
  linkEnvoy: (
    targetId: string,
    input: LinkEnvoyProjectInput,
  ): Promise<DeployTarget> =>
    requestData(deployTargetSchema, `/api/deploy/targets/${targetId}/envoy`, {
      method: "PUT",
      body: input,
    }),
  unlinkEnvoy: (targetId: string): Promise<DeployTarget> =>
    requestData(deployTargetSchema, `/api/deploy/targets/${targetId}/envoy`, {
      method: "DELETE",
    }),

  env: (targetId: string): Promise<DeployEnvVar[]> =>
    requestData(
      z.array(deployEnvVarSchema),
      `/api/deploy/targets/${targetId}/env`,
    ),
  replaceEnv: (
    targetId: string,
    input: ReplaceDeployEnvInput,
  ): Promise<DeployEnvVar[]> =>
    requestData(
      z.array(deployEnvVarSchema),
      `/api/deploy/targets/${targetId}/env`,
      { method: "PUT", body: input },
    ),
  /**
   * Recreates every live container so an env change takes effect. Not a
   * restart: env is fixed when a container is created, so the agent has to
   * replace it. Slower than every other mutation here because each
   * replacement is gated on the same health check a deploy uses.
   */
  applyEnv: (targetId: string): Promise<DeployApplyEnvReport> =>
    requestData(
      deployApplyEnvReportSchema,
      `/api/deploy/targets/${targetId}/apply-env`,
      { method: "POST", timeoutMs: APPLY_ENV_TIMEOUT_MS },
    ),
  bindings: (targetId: string): Promise<DeployBindings> =>
    requestData(deployBindingsSchema, `/api/deploy/bindings/${targetId}`),

  domains: (targetId: string): Promise<DeployDomain[]> =>
    requestData(
      z.array(deployDomainSchema),
      `/api/deploy/targets/${targetId}/domains`,
    ),
  addDomain: (
    targetId: string,
    input: CreateDeployDomainInput,
  ): Promise<DeployDomain> =>
    requestData(deployDomainSchema, `/api/deploy/targets/${targetId}/domains`, {
      method: "POST",
      body: input,
      timeoutMs: SLOW_TIMEOUT_MS,
    }),
  updateDomain: (
    id: string,
    input: UpdateDeployDomainInput,
  ): Promise<DeployDomain> =>
    requestData(deployDomainSchema, `/api/deploy/domains/${id}`, {
      method: "PATCH",
      body: input,
      timeoutMs: SLOW_TIMEOUT_MS,
    }),
  removeDomain: (id: string): Promise<{ id: string }> =>
    requestData(z.object({ id: z.uuid() }), `/api/deploy/domains/${id}`, {
      method: "DELETE",
    }),
  verifyDomain: (id: string): Promise<DeployDomain> =>
    requestData(deployDomainSchema, `/api/deploy/domains/${id}/verify`, {
      method: "POST",
      timeoutMs: SLOW_TIMEOUT_MS,
    }),
};
