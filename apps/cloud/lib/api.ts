import {
  apiErrorResponseSchema,
  type ContainerSnapshot,
  type CreateCollectionInput,
  type CreatedApiKey,
  type CreateMongoCollectionInput,
  type CreateMongoIndexInput,
  type CreatePgTableInput,
  type CreateProjectInput,
  type CreateProjectVectorIndexInput,
  type CreateTaskInput,
  containerSnapshotSchema,
  createdApiKeySchema,
  type DiscoverFieldsInput,
  type DiscoverFieldsResult,
  discoverFieldsResultSchema,
  type FindMongoDocumentsInput,
  type GenerateSearchTokenInput,
  type IssuedProjectS3Credential,
  issuedProjectS3CredentialSchema,
  type MetricsResponse,
  type MongoCollection,
  type MongoDatabase,
  type MongoFindResult,
  type MongoIndex,
  metricsResponseSchema,
  mongoCollectionSchema,
  mongoDatabaseSchema,
  mongoFindResultSchema,
  mongoIndexSchema,
  type OpsHealth,
  type OpsOverview,
  opsHealthSchema,
  opsOverviewSchema,
  type Pagination,
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
  type SafeApiKey,
  type SafeProject,
  type SafeProjectCollection,
  type SafeScheduledTask,
  type SafeTaskRun,
  type SafeUser,
  type SearchTokenResult,
  safeApiKeySchema,
  safeProjectCollectionSchema,
  safeProjectSchema,
  safeScheduledTaskSchema,
  safeTaskRunSchema,
  safeUserSchema,
  searchTokenResultSchema,
  type TerminalSession,
  terminalSessionSchema,
  type UpdateCollectionInput,
  type UpdateProjectInput,
  type UpdateTaskInput,
} from "@repo/schemas/cloud";
import { z } from "zod";
import { API_BASE_URL } from "./env";

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Request failed";
}

type QueryValue = string | number | boolean | undefined;
type Query = Record<string, QueryValue | QueryValue[]>;

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Query;
}

async function rawRequest(
  path: string,
  options: RequestOptions = {},
): Promise<unknown> {
  const url = new URL(path, API_BASE_URL);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    for (const entry of Array.isArray(value) ? value : [value]) {
      if (entry !== undefined) url.searchParams.append(key, String(entry));
    }
  }
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      credentials: "include",
      headers:
        options.body !== undefined
          ? { "Content-Type": "application/json" }
          : undefined,
      body:
        options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError("NETWORK", "API unreachable", 0);
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const parsed = apiErrorResponseSchema.safeParse(payload);
    if (parsed.success) {
      throw new ApiError(
        parsed.data.error.code,
        parsed.data.error.message,
        response.status,
      );
    }
    throw new ApiError(
      response.status === 401 ? "UNAUTHORIZED" : "HTTP_ERROR",
      `Request failed (${response.status})`,
      response.status,
    );
  }
  return response.json();
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

const successSchema = z.object({ success: z.boolean() });
const healthzSchema = z.object({ status: z.string(), version: z.string() });

export const api = {
  me: (): Promise<SafeUser> => requestData(safeUserSchema, "/api/me"),

  healthz: (): Promise<{ status: string; version: string }> =>
    rawRequest("/healthz").then((payload) => healthzSchema.parse(payload)),

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
      requestData(metricsResponseSchema, "/api/ops/metrics", { query }),
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
          { method: "POST", body: { type } },
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
          { method: "POST" },
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
        { method: "POST", body: { sql } },
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
        { method: "POST", body: input },
      ),
  },
};
