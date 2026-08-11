import type {
  CreateCollectionInput,
  CreatedApiKey,
  CreateProjectVectorIndexInput,
  DiscoverFieldsInput,
  DiscoverFieldsResult,
  GenerateSearchTokenInput,
  ProjectVectorIndex,
  ProjectVectorSearchOverview,
  SafeApiKey,
  SafeProject,
  SafeProjectCollection,
  SearchTokenResult,
  UpdateCollectionInput,
} from "@repo/schemas/cloud";
import {
  createdApiKeySchema,
  discoverFieldsResultSchema,
  projectVectorIndexSchema,
  projectVectorSearchOverviewSchema,
  safeApiKeySchema,
  safeProjectCollectionSchema,
  safeProjectSchema,
  searchTokenResultSchema,
} from "@repo/schemas/cloud";
import { z } from "zod";
import {
  type Paginated,
  requestData,
  requestPaginated,
  SLOW_TIMEOUT_MS,
} from "../api-client";

const successSchema = z.object({ success: z.boolean() });

/**
 * The namespace half of a project: API keys, the search key, the collections
 * synced into Meilisearch and the vector indexes on Mongo. Distinct from
 * `deployApi`, which owns everything about the deployable.
 *
 * Shared here rather than in the app for the reason `deployApi` is: these
 * routes need PATCH and DELETE, and Forge's own request core is GET/POST only
 * — deliberately, since folding the two cores together would change the query
 * building of every Forge call.
 */
export const projectsApi = {
  list: (query?: {
    page?: number;
    limit?: number;
  }): Promise<Paginated<SafeProject>> =>
    requestPaginated(safeProjectSchema, "/api/projects", { query }),
  get: (id: string): Promise<SafeProject> =>
    requestData(safeProjectSchema, `/api/projects/${id}`),

  apiKeys: {
    list: (projectId: string): Promise<SafeApiKey[]> =>
      requestData(
        z.array(safeApiKeySchema),
        `/api/projects/${projectId}/api-keys`,
      ),
    /** The only response carrying the key itself; nothing reads it back. */
    create: (
      projectId: string,
      input: { name: string; scopes: string[]; expiresIn?: string },
    ): Promise<CreatedApiKey> =>
      requestData(createdApiKeySchema, `/api/projects/${projectId}/api-keys`, {
        method: "POST",
        body: input,
      }),
    rotate: (projectId: string, keyId: string): Promise<CreatedApiKey> =>
      requestData(
        createdApiKeySchema,
        `/api/projects/${projectId}/api-keys/${keyId}/rotate`,
        { method: "POST" },
      ),
    revoke: (projectId: string, keyId: string): Promise<{ success: boolean }> =>
      requestData(
        successSchema,
        `/api/projects/${projectId}/api-keys/${keyId}`,
        { method: "DELETE" },
      ),
  },

  collections: {
    list: (projectId: string): Promise<SafeProjectCollection[]> =>
      requestData(
        z.array(safeProjectCollectionSchema),
        `/api/projects/${projectId}/collections`,
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
        // Reindexes the whole collection into Meilisearch.
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

  /** Source pickers for a postgres-backed collection. */
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
};
