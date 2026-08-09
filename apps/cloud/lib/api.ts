import { toApiError, toTransportError } from "@repo/cloud-ui/api-error";
import {
  type ActivityExportQuery,
  type ActivityFacets,
  type ActivityQuery,
  type AlertRule,
  type AlertRuleCreate,
  type AlertRuleListResponse,
  type AlertRuleUpdate,
  activityFacetsSchema,
  alertRuleListResponseSchema,
  alertRuleResponseSchema,
  type CompleteSignupInput,
  type CompleteSignupResult,
  type ContainerSnapshot,
  type CreateCollectionInput,
  type CreateDeployDomainInput,
  type CreateDeploymentInput,
  type CreateDeployTargetRequest,
  type CreatedApiKey,
  type CreateMongoCollectionInput,
  type CreateMongoIndexInput,
  type CreatePgTableInput,
  type CreateProjectInput,
  type CreateProjectVectorIndexInput,
  type CreateTaskInput,
  completeSignupResultSchema,
  containerSnapshotSchema,
  createdApiKeySchema,
  type DeployBindings,
  type DeployCapacity,
  type DeployDomain,
  type DeployEnvVar,
  type Deployment,
  type DeployTarget,
  type DeployTargetListEntry,
  type DetectBuildResponse,
  type DiscoverFieldsInput,
  type DiscoverFieldsResult,
  deployBindingsSchema,
  deployCapacitySchema,
  deployDomainSchema,
  deployEnvVarSchema,
  deploymentSchema,
  deployTargetListEntrySchema,
  deployTargetSchema,
  detectBuildResponseSchema,
  discoverFieldsResultSchema,
  type FindMongoDocumentsInput,
  type GenerateSearchTokenInput,
  type GithubConnection,
  type GithubInstallationSummary,
  type GithubRepositorySummary,
  githubBranchSchema,
  githubConnectionSchema,
  githubInstallationSummarySchema,
  githubRepositorySchema,
  githubTreeEntrySchema,
  type IssuedProjectS3Credential,
  issuedProjectS3CredentialSchema,
  type LargestFile,
  type LinkEnvoyProjectInput,
  largestFileSchema,
  type MetricCatalogResponse,
  type MetricsResponse,
  type MongoCollection,
  type MongoDatabase,
  type MongoFindResult,
  type MongoIndex,
  metricCatalogResponseSchema,
  metricsResponseSchema,
  mongoCollectionSchema,
  mongoDatabaseSchema,
  mongoFindResultSchema,
  mongoIndexSchema,
  type NotificationTestResult,
  notificationTestResultSchema,
  type OpsHealth,
  type OpsOverview,
  opsHealthSchema,
  opsOverviewSchema,
  type Pagination,
  type PendingUserCreated,
  type PgDatabase,
  type PgQueryResult,
  type PgSchema,
  type PgTable,
  type PgTableDetail,
  type ProjectDatabase,
  type ProjectDatabaseMetadata,
  type ProjectS3CredentialMetadata,
  type ProjectVectorIndex,
  type ProjectVectorSearchOverview,
  paginationSchema,
  pendingUserCreatedSchema,
  pgDatabaseSchema,
  pgQueryResultSchema,
  pgSchemaSchema,
  pgTableDetailSchema,
  pgTableSchema,
  projectDatabaseMetadataSchema,
  projectDatabaseSchema,
  projectS3CredentialMetadataSchema,
  projectVectorIndexSchema,
  projectVectorSearchOverviewSchema,
  type ReplaceDeployEnvInput,
  type RepoBadge,
  repoBadgeSchema,
  type S3BucketUsage,
  type S3CredentialMetadata,
  type SafeActivityEntry,
  type SafeApiKey,
  type SafeNotificationEvent,
  type SafeProject,
  type SafeProjectCollection,
  type SafeScheduledTask,
  type SafeTaskRun,
  type SafeUser,
  type SearchTokenResult,
  type StorageStats,
  type StorageTypeBreakdown,
  s3BucketUsageSchema,
  s3CredentialMetadataSchema,
  safeActivityEntrySchema,
  safeApiKeySchema,
  safeNotificationEventSchema,
  safeProjectCollectionSchema,
  safeProjectSchema,
  safeScheduledTaskSchema,
  safeTaskRunSchema,
  safeUserSchema,
  searchTokenResultSchema,
  storageStatsSchema,
  storageTypeBreakdownSchema,
  type TerminalSession,
  type TieringConfigPatch,
  type TieringSettings,
  terminalSessionSchema,
  tieringSettingsSchema,
  type UpdateCollectionInput,
  type UpdateDeployDomainInput,
  type UpdateDeployTargetInput,
  type UpdateProjectInput,
  type UpdateTaskInput,
  type UserStorageStat,
  userStorageStatSchema,
} from "@repo/schemas/cloud";
import { z } from "zod";
import { API_BASE_URL } from "./env";

export {
  ApiError,
  errorMessage,
  isApiError,
  isUnreachable,
} from "@repo/cloud-ui/api-error";

type QueryValue = string | number | boolean | undefined;
type Query = Record<string, QueryValue | QueryValue[]>;

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Query;
  timeoutMs?: number;
}

// Without a deadline a stalled connection keeps `usePoll` in `loading` forever
// and every interval tick stacks another hung request on top of it.
const DEFAULT_TIMEOUT_MS = 30_000;
// Query consoles, provisioning and manual task runs legitimately take longer.
const SLOW_TIMEOUT_MS = 120_000;

function buildUrl(path: string, query: RequestOptions["query"]): URL {
  const url = new URL(path, API_BASE_URL);
  for (const [key, value] of Object.entries(query ?? {})) {
    for (const entry of Array.isArray(value) ? value : [value]) {
      if (entry !== undefined) url.searchParams.append(key, String(entry));
    }
  }
  return url;
}

async function sendRequest(
  path: string,
  options: RequestOptions = {},
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method: options.method ?? "GET",
      credentials: "include",
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      headers:
        options.body !== undefined
          ? { "Content-Type": "application/json" }
          : undefined,
      body:
        options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch (error) {
    throw toTransportError(error);
  }
  if (!response.ok) throw await toApiError(response);
  return response;
}

async function rawRequest(
  path: string,
  options: RequestOptions = {},
): Promise<unknown> {
  return (await sendRequest(path, options)).json();
}

/**
 * Buffers the response and hands it to the browser as a download.
 *
 * A plain anchor would be lighter, but the session cookie is set on the API's
 * origin and this app is served from another, so only a `credentials: "include"`
 * fetch is guaranteed to carry it.
 */
async function requestDownload(
  path: string,
  fallbackFilename: string,
  options: RequestOptions = {},
): Promise<void> {
  const response = await sendRequest(path, options);
  const disposition = response.headers.get("Content-Disposition");
  const filename =
    disposition?.match(/filename="([^"]+)"/)?.[1] ?? fallbackFilename;

  const href = URL.createObjectURL(await response.blob());
  try {
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = filename;
    anchor.click();
  } finally {
    URL.revokeObjectURL(href);
  }
}

const envelopeSchema = z.object({ data: z.unknown() });

async function requestData<T extends z.ZodType>(
  schema: T,
  path: string,
  options: RequestOptions = {},
): Promise<z.output<T>> {
  const payload = await rawRequest(path, options);
  return schema.parse(envelopeSchema.parse(payload).data);
}

export interface Paginated<T> {
  items: T[];
  pagination: Pagination;
}

const paginatedEnvelopeSchema = z.object({
  data: z.array(z.unknown()),
  pagination: paginationSchema,
});

async function requestPaginated<T extends z.ZodType>(
  schema: T,
  path: string,
  options: RequestOptions = {},
): Promise<Paginated<z.output<T>>> {
  const payload = await rawRequest(path, options);
  const parsed = paginatedEnvelopeSchema.parse(payload);
  return {
    items: parsed.data.map((item) => schema.parse(item)),
    pagination: parsed.pagination,
  };
}

/** The filters the paged list and the export share, verbatim. */
function activityFilterQuery(
  query: Partial<ActivityQuery & ActivityExportQuery>,
) {
  return {
    category: query.category,
    severity: query.severity,
    actorType: query.actorType,
    method: query.method,
    statusClass: query.statusClass,
    action: query.action,
    actorId: query.actorId,
    pathPrefix: query.pathPrefix,
    ip: query.ip,
    minDurationMs: query.minDurationMs,
    from: query.from,
    to: query.to,
    q: query.q,
  };
}

const successSchema = z.object({ success: z.boolean() });
const healthzSchema = z.object({ status: z.string(), version: z.string() });

export const api = {
  me: (): Promise<SafeUser> => requestData(safeUserSchema, "/api/me"),

  completeSignup: (input: CompleteSignupInput): Promise<CompleteSignupResult> =>
    requestData(completeSignupResultSchema, "/api/auth/complete-signup", {
      method: "POST",
      body: input,
    }),

  healthz: (): Promise<{ status: string; version: string }> =>
    rawRequest("/healthz").then((payload) => healthzSchema.parse(payload)),

  users: {
    list: (query?: {
      page?: number;
      limit?: number;
    }): Promise<Paginated<SafeUser>> =>
      requestPaginated(safeUserSchema, "/api/auth/admin/users", { query }),
    createPending: (input: {
      username: string;
      role: "superuser" | "user";
    }): Promise<PendingUserCreated> =>
      requestData(
        pendingUserCreatedSchema,
        "/api/auth/admin/create-pending-user",
        { method: "POST", body: input },
      ),
    remove: (userId: string): Promise<{ success: boolean }> =>
      rawRequest("/api/auth/admin/remove-user", {
        method: "POST",
        body: { userId },
      }).then((payload) => successSchema.parse(payload)),
    resetMfa: (userId: string): Promise<{ success: boolean }> =>
      rawRequest("/api/auth/admin/reset-mfa", {
        method: "POST",
        body: { userId },
      }).then((payload) => successSchema.parse(payload)),
  },

  ops: {
    overview: (): Promise<OpsOverview> =>
      requestData(opsOverviewSchema, "/api/ops/overview"),
    health: (): Promise<OpsHealth> =>
      requestData(opsHealthSchema, "/api/ops/health"),
    metrics: (query: {
      series: string[];
      from: string;
      to: string;
      step?: number;
    }): Promise<MetricsResponse> =>
      requestData(metricsResponseSchema, "/api/ops/metrics", {
        query: { ...query, series: query.series.join(",") },
      }),
    containers: (): Promise<ContainerSnapshot[]> =>
      requestData(z.array(containerSnapshotSchema), "/api/ops/containers"),
    restartContainer: (
      id: string,
    ): Promise<{ task: SafeScheduledTask; run: SafeTaskRun }> =>
      requestData(
        z.object({ task: safeScheduledTaskSchema, run: safeTaskRunSchema }),
        `/api/ops/containers/${encodeURIComponent(id)}/restart`,
        { method: "POST" },
      ),
    tiering: {
      get: (): Promise<TieringSettings> =>
        requestData(tieringSettingsSchema, "/api/ops/storage/tiering"),
      update: (input: TieringConfigPatch): Promise<TieringSettings> =>
        requestData(tieringSettingsSchema, "/api/ops/storage/tiering", {
          method: "PATCH",
          body: input,
        }),
    },
  },

  activity: {
    list: (
      query: Partial<ActivityQuery> = {},
    ): Promise<Paginated<SafeActivityEntry>> =>
      requestPaginated(safeActivityEntrySchema, "/api/ops/activity", {
        query: {
          page: query.page,
          limit: query.limit,
          ...activityFilterQuery(query),
        },
      }),
    facets: (days?: number): Promise<ActivityFacets> =>
      requestData(activityFacetsSchema, "/api/ops/activity/facets", {
        query: { days },
      }),
    // Streams server-side, so it outlasts the default timeout on a wide filter.
    exportNdjson: (query: Partial<ActivityExportQuery> = {}): Promise<void> =>
      requestDownload("/api/ops/activity/export", "activity.ndjson", {
        query: { limit: query.limit, ...activityFilterQuery(query) },
        timeoutMs: SLOW_TIMEOUT_MS,
      }),
  },

  alertRules: {
    list: (): Promise<AlertRuleListResponse> =>
      requestData(alertRuleListResponseSchema, "/api/ops/alert-rules"),
    catalog: (): Promise<MetricCatalogResponse> =>
      requestData(metricCatalogResponseSchema, "/api/ops/alert-rules/catalog"),
    create: (input: AlertRuleCreate): Promise<{ rule: AlertRule }> =>
      requestData(alertRuleResponseSchema, "/api/ops/alert-rules", {
        method: "POST",
        body: input,
      }),
    update: (
      id: string,
      input: AlertRuleUpdate,
    ): Promise<{ rule: AlertRule }> =>
      requestData(alertRuleResponseSchema, `/api/ops/alert-rules/${id}`, {
        method: "PATCH",
        body: input,
      }),
    remove: (id: string): Promise<{ status: string }> =>
      requestData(
        z.object({ status: z.string() }),
        `/api/ops/alert-rules/${id}`,
        { method: "DELETE" },
      ),
  },

  notifications: {
    list: (limit?: number): Promise<SafeNotificationEvent[]> =>
      requestData(
        z.array(safeNotificationEventSchema),
        "/api/ops/notifications",
        { query: { limit } },
      ),
    test: (): Promise<NotificationTestResult> =>
      requestData(notificationTestResultSchema, "/api/ops/notifications/test", {
        method: "POST",
      }),
  },

  tasks: {
    list: (query?: {
      page?: number;
      limit?: number;
    }): Promise<{
      tasks: SafeScheduledTask[];
      latestRuns: SafeTaskRun[];
      pagination: Pagination;
    }> =>
      rawRequest("/api/ops/tasks", { query }).then((payload) => {
        const parsed = z
          .object({
            data: z.object({
              tasks: z.array(safeScheduledTaskSchema),
              latestRuns: z.array(safeTaskRunSchema),
            }),
            pagination: paginationSchema,
          })
          .parse(payload);
        return { ...parsed.data, pagination: parsed.pagination };
      }),
    get: (id: string): Promise<SafeScheduledTask> =>
      requestData(safeScheduledTaskSchema, `/api/ops/tasks/${id}`),
    create: (input: CreateTaskInput): Promise<SafeScheduledTask> =>
      requestData(safeScheduledTaskSchema, "/api/ops/tasks", {
        method: "POST",
        body: input,
      }),
    update: (id: string, input: UpdateTaskInput): Promise<SafeScheduledTask> =>
      requestData(safeScheduledTaskSchema, `/api/ops/tasks/${id}`, {
        method: "PATCH",
        body: input,
      }),
    remove: (id: string): Promise<{ success: boolean }> =>
      requestData(successSchema, `/api/ops/tasks/${id}`, { method: "DELETE" }),
    run: (id: string): Promise<SafeTaskRun> =>
      requestData(safeTaskRunSchema, `/api/ops/tasks/${id}/run`, {
        method: "POST",
        timeoutMs: SLOW_TIMEOUT_MS,
      }),
    runs: (
      id: string,
      query?: { page?: number; limit?: number },
    ): Promise<Paginated<SafeTaskRun>> =>
      requestPaginated(safeTaskRunSchema, `/api/ops/tasks/${id}/runs`, {
        query,
      }),
  },

  terminal: {
    mint: (
      sessionId?: string,
    ): Promise<{ ticket: string; sessionId: string; expiresAt: string }> =>
      requestData(
        z.object({
          ticket: z.string(),
          sessionId: z.string(),
          expiresAt: z.string(),
        }),
        "/api/ops/terminal",
        { method: "POST", body: sessionId ? { sessionId } : {} },
      ),
    sessions: (): Promise<TerminalSession[]> =>
      requestData(z.array(terminalSessionSchema), "/api/ops/terminal/sessions"),
    kill: (id: string): Promise<{ success: boolean }> =>
      requestData(
        successSchema,
        `/api/ops/terminal/sessions/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      ),
  },

  projects: {
    list: (query?: {
      page?: number;
      limit?: number;
    }): Promise<Paginated<SafeProject>> =>
      requestPaginated(safeProjectSchema, "/api/projects", { query }),
    get: (id: string): Promise<SafeProject> =>
      requestData(safeProjectSchema, `/api/projects/${id}`),
    create: (input: CreateProjectInput): Promise<SafeProject> =>
      requestData(safeProjectSchema, "/api/projects", {
        method: "POST",
        body: input,
      }),
    update: (id: string, input: UpdateProjectInput): Promise<SafeProject> =>
      requestData(safeProjectSchema, `/api/projects/${id}`, {
        method: "PATCH",
        body: input,
      }),
    remove: (id: string): Promise<{ success: boolean }> =>
      requestData(successSchema, `/api/projects/${id}`, { method: "DELETE" }),

    apiKeys: {
      list: (projectId: string): Promise<SafeApiKey[]> =>
        requestData(
          z.array(safeApiKeySchema),
          `/api/projects/${projectId}/api-keys`,
        ),
      create: (
        projectId: string,
        input: { name: string; scopes: string[]; expiresIn?: string },
      ): Promise<CreatedApiKey> =>
        requestData(
          createdApiKeySchema,
          `/api/projects/${projectId}/api-keys`,
          { method: "POST", body: input },
        ),
      rotate: (projectId: string, keyId: string): Promise<CreatedApiKey> =>
        requestData(
          createdApiKeySchema,
          `/api/projects/${projectId}/api-keys/${keyId}/rotate`,
          { method: "POST" },
        ),
      revoke: (
        projectId: string,
        keyId: string,
      ): Promise<{ success: boolean }> =>
        requestData(
          successSchema,
          `/api/projects/${projectId}/api-keys/${keyId}`,
          { method: "DELETE" },
        ),
    },

    s3Credentials: {
      list: (projectId: string): Promise<ProjectS3CredentialMetadata[]> =>
        requestData(
          z.array(projectS3CredentialMetadataSchema),
          `/api/projects/${projectId}/s3-credentials`,
        ),
      create: (
        projectId: string,
        label: string,
      ): Promise<IssuedProjectS3Credential> =>
        requestData(
          issuedProjectS3CredentialSchema,
          `/api/projects/${projectId}/s3-credentials`,
          { method: "POST", body: { label } },
        ),
      rotate: (
        projectId: string,
        credentialId: string,
      ): Promise<IssuedProjectS3Credential> =>
        requestData(
          issuedProjectS3CredentialSchema,
          `/api/projects/${projectId}/s3-credentials/${credentialId}/rotate`,
          { method: "POST" },
        ),
      revoke: (
        projectId: string,
        credentialId: string,
      ): Promise<{ revoked: boolean }> =>
        requestData(
          z.object({ revoked: z.boolean() }),
          `/api/projects/${projectId}/s3-credentials/${credentialId}`,
          { method: "DELETE" },
        ),
    },

    databases: {
      list: (projectId: string): Promise<ProjectDatabaseMetadata[]> =>
        requestData(
          z.array(projectDatabaseMetadataSchema),
          `/api/projects/${projectId}/databases`,
        ),
      provision: (
        projectId: string,
        type: "postgres" | "mongodb" | "redis",
      ): Promise<ProjectDatabase> =>
        requestData(
          projectDatabaseSchema,
          `/api/projects/${projectId}/databases`,
          { method: "POST", body: { type }, timeoutMs: SLOW_TIMEOUT_MS },
        ),
      deprovision: (projectId: string, databaseId: string): Promise<null> =>
        requestData(
          z.null(),
          `/api/projects/${projectId}/databases/${databaseId}`,
          { method: "DELETE" },
        ),
    },

    collections: {
      list: (projectId: string): Promise<SafeProjectCollection[]> =>
        requestData(
          z.array(safeProjectCollectionSchema),
          `/api/projects/${projectId}/collections`,
        ),
      get: (
        projectId: string,
        collectionId: string,
      ): Promise<SafeProjectCollection> =>
        requestData(
          safeProjectCollectionSchema,
          `/api/projects/${projectId}/collections/${collectionId}`,
        ),
      create: (
        projectId: string,
        input: CreateCollectionInput,
      ): Promise<SafeProjectCollection> =>
        requestData(
          safeProjectCollectionSchema,
          `/api/projects/${projectId}/collections`,
          { method: "POST", body: input },
        ),
      update: (
        projectId: string,
        collectionId: string,
        input: UpdateCollectionInput,
      ): Promise<SafeProjectCollection> =>
        requestData(
          safeProjectCollectionSchema,
          `/api/projects/${projectId}/collections/${collectionId}`,
          { method: "PATCH", body: input },
        ),
      remove: (
        projectId: string,
        collectionId: string,
      ): Promise<{ success: boolean }> =>
        requestData(
          successSchema,
          `/api/projects/${projectId}/collections/${collectionId}`,
          { method: "DELETE" },
        ),
      resync: (
        projectId: string,
        collectionId: string,
      ): Promise<{ success: boolean; message?: string }> =>
        requestData(
          z.object({ success: z.boolean(), message: z.string().optional() }),
          `/api/projects/${projectId}/collections/${collectionId}/resync`,
          { method: "POST", timeoutMs: SLOW_TIMEOUT_MS },
        ),
      discoverFields: (
        projectId: string,
        input: DiscoverFieldsInput,
      ): Promise<DiscoverFieldsResult> =>
        requestData(
          discoverFieldsResultSchema,
          `/api/projects/${projectId}/collections/discover-fields`,
          { method: "POST", body: input },
        ),
    },

    searchToken: (
      projectId: string,
      input: GenerateSearchTokenInput,
    ): Promise<SearchTokenResult> =>
      requestData(
        searchTokenResultSchema,
        `/api/projects/${projectId}/search-token`,
        { method: "POST", body: input },
      ),

    pgSources: {
      databases: (projectId: string): Promise<string[]> =>
        requestData(
          z.array(z.union([z.string(), z.object({ name: z.string() })])),
          `/api/projects/${projectId}/pg-databases`,
        ).then((rows) =>
          rows.map((row) => (typeof row === "string" ? row : row.name)),
        ),
      schemas: (projectId: string, database: string): Promise<string[]> =>
        requestData(
          z.array(z.union([z.string(), z.object({ name: z.string() })])),
          `/api/projects/${projectId}/pg-schemas`,
          { query: { database } },
        ).then((rows) =>
          rows.map((row) => (typeof row === "string" ? row : row.name)),
        ),
      tables: (
        projectId: string,
        database: string,
        schema: string,
      ): Promise<string[]> =>
        requestData(
          z.array(z.union([z.string(), z.object({ name: z.string() })])),
          `/api/projects/${projectId}/pg-tables`,
          { query: { database, schema } },
        ).then((rows) =>
          rows.map((row) => (typeof row === "string" ? row : row.name)),
        ),
    },

    vectorIndexes: {
      overview: (projectId: string): Promise<ProjectVectorSearchOverview> =>
        requestData(
          projectVectorSearchOverviewSchema,
          `/api/projects/${projectId}/vector-indexes`,
        ),
      create: (
        projectId: string,
        input: CreateProjectVectorIndexInput,
      ): Promise<ProjectVectorIndex> =>
        requestData(
          projectVectorIndexSchema,
          `/api/projects/${projectId}/vector-indexes`,
          { method: "POST", body: input },
        ),
      remove: (
        projectId: string,
        collection: string,
        indexName: string,
      ): Promise<unknown> =>
        requestData(
          z.unknown(),
          `/api/projects/${projectId}/vector-indexes/${encodeURIComponent(collection)}/${encodeURIComponent(indexName)}`,
          { method: "DELETE" },
        ),
    },
  },

  deploy: {
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
      badges: (
        repos: { owner: string; name: string }[],
      ): Promise<RepoBadge[]> =>
        requestData(
          z.array(repoBadgeSchema),
          "/api/deploy/github/repos/badges",
          {
            method: "POST",
            body: { repos },
            // One Contents call per repository, run concurrently.
            timeoutMs: SLOW_TIMEOUT_MS,
          },
        ),
    },

    targets: (): Promise<DeployTargetListEntry[]> =>
      requestData(z.array(deployTargetListEntrySchema), "/api/deploy/targets"),
    target: (id: string): Promise<DeployTarget> =>
      requestData(deployTargetSchema, `/api/deploy/targets/${id}`),
    createTarget: (input: CreateDeployTargetRequest): Promise<DeployTarget> =>
      requestData(deployTargetSchema, "/api/deploy/targets", {
        method: "POST",
        body: input,
        // Creating a target provisions a DNS record on Cloudflare, and may
        // provision the project it belongs to first.
        timeoutMs: SLOW_TIMEOUT_MS,
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
    create: (
      targetId: string,
      input: CreateDeploymentInput,
    ): Promise<Deployment> =>
      requestData(
        deploymentSchema,
        `/api/deploy/targets/${targetId}/deployments`,
        { method: "POST", body: input, timeoutMs: SLOW_TIMEOUT_MS },
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
      requestData(
        deployDomainSchema,
        `/api/deploy/targets/${targetId}/domains`,
        { method: "POST", body: input, timeoutMs: SLOW_TIMEOUT_MS },
      ),
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
  },

  storageAnalytics: {
    stats: (): Promise<StorageStats> =>
      requestData(storageStatsSchema, "/api/ops/storage/stats"),
    largestFiles: (limit?: number): Promise<LargestFile[]> =>
      requestData(
        z.array(largestFileSchema),
        "/api/ops/storage/largest-files",
        { query: { limit } },
      ),
    byUser: (): Promise<UserStorageStat[]> =>
      requestData(z.array(userStorageStatSchema), "/api/ops/storage/by-user"),
    byType: (limit?: number): Promise<StorageTypeBreakdown[]> =>
      requestData(
        z.array(storageTypeBreakdownSchema),
        "/api/ops/storage/by-type",
        { query: { limit } },
      ),
    s3Usage: (): Promise<S3BucketUsage[]> =>
      requestData(z.array(s3BucketUsageSchema), "/api/ops/storage/s3-usage"),
  },

  storageAdmin: {
    legacyS3Credentials: (): Promise<S3CredentialMetadata[]> =>
      requestData(
        z.array(s3CredentialMetadataSchema),
        "/api/storage/s3-credentials",
      ),
  },

  pg: {
    databases: (): Promise<PgDatabase[]> =>
      requestData(z.array(pgDatabaseSchema), "/api/db/postgres/databases"),
    createDatabase: (name: string): Promise<{ name: string }> =>
      requestData(
        z.object({ name: z.string() }),
        "/api/db/postgres/databases",
        { method: "POST", body: { name } },
      ),
    dropDatabase: (name: string): Promise<unknown> =>
      requestData(
        z.unknown(),
        `/api/db/postgres/databases/${encodeURIComponent(name)}`,
        { method: "DELETE" },
      ),
    schemas: (database: string): Promise<PgSchema[]> =>
      requestData(
        z.array(pgSchemaSchema),
        `/api/db/postgres/databases/${encodeURIComponent(database)}/schemas`,
      ),
    tables: (database: string, schema?: string): Promise<PgTable[]> =>
      requestData(
        z.array(pgTableSchema),
        `/api/db/postgres/databases/${encodeURIComponent(database)}/tables`,
        { query: { schema } },
      ),
    tableDetail: (
      database: string,
      table: string,
      schema?: string,
    ): Promise<PgTableDetail> =>
      requestData(
        pgTableDetailSchema,
        `/api/db/postgres/databases/${encodeURIComponent(database)}/tables/${encodeURIComponent(table)}`,
        { query: { schema } },
      ),
    createTable: (
      database: string,
      input: CreatePgTableInput & { schema?: string },
    ): Promise<unknown> =>
      requestData(
        z.unknown(),
        `/api/db/postgres/databases/${encodeURIComponent(database)}/tables`,
        { method: "POST", body: input },
      ),
    dropTable: (
      database: string,
      table: string,
      schema?: string,
    ): Promise<unknown> =>
      requestData(
        z.unknown(),
        `/api/db/postgres/databases/${encodeURIComponent(database)}/tables/${encodeURIComponent(table)}`,
        { method: "DELETE", query: { schema } },
      ),
    query: (database: string, sql: string): Promise<PgQueryResult> =>
      requestData(
        pgQueryResultSchema,
        `/api/db/postgres/databases/${encodeURIComponent(database)}/query`,
        { method: "POST", body: { sql }, timeoutMs: SLOW_TIMEOUT_MS },
      ),
  },

  mongo: {
    databases: (): Promise<MongoDatabase[]> =>
      requestData(z.array(mongoDatabaseSchema), "/api/db/mongodb/databases"),
    createDatabase: (name: string): Promise<{ name: string }> =>
      requestData(z.object({ name: z.string() }), "/api/db/mongodb/databases", {
        method: "POST",
        body: { name },
      }),
    dropDatabase: (name: string): Promise<unknown> =>
      requestData(
        z.unknown(),
        `/api/db/mongodb/databases/${encodeURIComponent(name)}`,
        { method: "DELETE" },
      ),
    collections: (database: string): Promise<MongoCollection[]> =>
      requestData(
        z.array(mongoCollectionSchema),
        `/api/db/mongodb/databases/${encodeURIComponent(database)}/collections`,
      ),
    createCollection: (
      database: string,
      input: CreateMongoCollectionInput,
    ): Promise<{ name: string }> =>
      requestData(
        z.object({ name: z.string() }),
        `/api/db/mongodb/databases/${encodeURIComponent(database)}/collections`,
        { method: "POST", body: input },
      ),
    dropCollection: (database: string, collection: string): Promise<unknown> =>
      requestData(
        z.unknown(),
        `/api/db/mongodb/databases/${encodeURIComponent(database)}/collections/${encodeURIComponent(collection)}`,
        { method: "DELETE" },
      ),
    indexes: (database: string, collection: string): Promise<MongoIndex[]> =>
      requestData(
        z.array(mongoIndexSchema),
        `/api/db/mongodb/databases/${encodeURIComponent(database)}/collections/${encodeURIComponent(collection)}/indexes`,
      ),
    createIndex: (
      database: string,
      collection: string,
      input: CreateMongoIndexInput,
    ): Promise<{ name: string }> =>
      requestData(
        z.object({ name: z.string() }),
        `/api/db/mongodb/databases/${encodeURIComponent(database)}/collections/${encodeURIComponent(collection)}/indexes`,
        { method: "POST", body: input },
      ),
    dropIndex: (
      database: string,
      collection: string,
      index: string,
    ): Promise<unknown> =>
      requestData(
        z.unknown(),
        `/api/db/mongodb/databases/${encodeURIComponent(database)}/collections/${encodeURIComponent(collection)}/indexes/${encodeURIComponent(index)}`,
        { method: "DELETE" },
      ),
    sample: (
      database: string,
      collection: string,
    ): Promise<Record<string, unknown>[]> =>
      requestData(
        z.array(z.record(z.string(), z.unknown())),
        `/api/db/mongodb/databases/${encodeURIComponent(database)}/collections/${encodeURIComponent(collection)}/sample`,
      ),
    find: (
      database: string,
      collection: string,
      input: FindMongoDocumentsInput,
    ): Promise<MongoFindResult> =>
      requestData(
        mongoFindResultSchema,
        `/api/db/mongodb/databases/${encodeURIComponent(database)}/collections/${encodeURIComponent(collection)}/find`,
        { method: "POST", body: input, timeoutMs: SLOW_TIMEOUT_MS },
      ),
  },
};
