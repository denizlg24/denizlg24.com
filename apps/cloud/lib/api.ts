import {
  type Paginated,
  rawRequest,
  requestData,
  requestDownload,
  requestPaginated,
  SLOW_TIMEOUT_MS,
} from "@repo/cloud-ui/api-client";
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
  type CreateMongoCollectionInput,
  type CreateMongoIndexInput,
  type CreatePgTableInput,
  type CreateTaskInput,
  completeSignupResultSchema,
  containerSnapshotSchema,
  type FindMongoDocumentsInput,
  type LargestFile,
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
  paginationSchema,
  pendingUserCreatedSchema,
  pgDatabaseSchema,
  pgQueryResultSchema,
  pgSchemaSchema,
  pgTableDetailSchema,
  pgTableSchema,
  type S3BucketUsage,
  type S3CredentialMetadata,
  type SafeActivityEntry,
  type SafeNotificationEvent,
  type SafeScheduledTask,
  type SafeTaskRun,
  type SafeUser,
  type StorageStats,
  type StorageTypeBreakdown,
  s3BucketUsageSchema,
  s3CredentialMetadataSchema,
  safeActivityEntrySchema,
  safeNotificationEventSchema,
  safeScheduledTaskSchema,
  safeTaskRunSchema,
  safeUserSchema,
  storageStatsSchema,
  storageTypeBreakdownSchema,
  type TerminalSession,
  type TieringConfigPatch,
  type TieringSettings,
  terminalSessionSchema,
  tieringSettingsSchema,
  type UpdateTaskInput,
  type UserStorageStat,
  userStorageStatSchema,
} from "@repo/schemas/cloud";
import { z } from "zod";

export type { Paginated } from "@repo/cloud-ui/api-client";
export {
  ApiError,
  errorMessage,
  isApiError,
  isUnreachable,
} from "@repo/cloud-ui/api-error";
export {
  type DeployApplyEnvReport,
  deployApplyEnvReportSchema,
} from "@repo/cloud-ui/deploy/api";

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

  // No create or drop for a database itself. Cloud keeps the engines — what
  // each daemon is carrying, and the introspection Forge has no answer for —
  // while a database with a credential and a connection is a resource, and
  // resources are provisioned from Forge.
  pg: {
    databases: (): Promise<PgDatabase[]> =>
      requestData(z.array(pgDatabaseSchema), "/api/db/postgres/databases"),
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
