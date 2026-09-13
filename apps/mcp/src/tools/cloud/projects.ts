import type { McpServer } from "@modelcontextprotocol/server";
import {
  createApiKeyInputSchema,
  createCollectionInputSchema,
  createProjectInputSchema,
  createProjectS3CredentialInputSchema,
  createProjectVectorIndexInputSchema,
  discoverFieldsInputSchema,
  generateSearchTokenInputSchema,
  provisionDatabaseInputSchema,
  updateCollectionInputSchema,
  updateProjectInputSchema,
} from "@repo/schemas/cloud";
import { z } from "zod";
import {
  type Api,
  action,
  defineActions,
  defineTool,
  limit,
  p,
  page,
  uuid,
} from "../define";

const projectId = uuid.describe("Cloud project id");
const collectionId = uuid.describe("Search collection id");

export function registerCloudProjects(server: McpServer, api: Api) {
  defineTool(server, {
    name: "cloud_projects_list",
    title: "Cloud: projects",
    description:
      "Cloud projects (the unit API keys, S3 credentials, databases and search collections hang off).",
    input: z.object({ page, limit }),
    annotations: { readOnlyHint: true },
    run: (query) => api.cloud.get("/api/projects", query),
  });

  defineTool(server, {
    name: "cloud_project_get",
    title: "Cloud: project",
    description: "One project.",
    input: z.object({ projectId }),
    annotations: { readOnlyHint: true },
    run: ({ projectId }) => api.cloud.get(p`/api/projects/${projectId}`),
  });

  defineTool(server, {
    name: "cloud_project_create",
    title: "Cloud: create project",
    description:
      "Creates a project. The slug names its S3 bucket and storage root.",
    input: z.object(createProjectInputSchema.shape),
    run: (body) => api.cloud.post("/api/projects", body),
  });

  defineTool(server, {
    name: "cloud_project_update",
    title: "Cloud: update project",
    description: "Name or description.",
    input: z.object({ projectId, ...updateProjectInputSchema.shape }),
    annotations: { idempotentHint: true },
    run: ({ projectId, ...body }) =>
      api.cloud.patch(p`/api/projects/${projectId}`, body),
  });

  defineTool(server, {
    name: "cloud_project_delete",
    title: "Cloud: delete project",
    description:
      "Removes the project, its keys, credentials, collections and provisioned databases.",
    input: z.object({ projectId }),
    annotations: { destructiveHint: true },
    run: ({ projectId }) => api.cloud.delete(p`/api/projects/${projectId}`),
  });

  // API keys ---------------------------------------------------------------

  defineTool(server, {
    name: "cloud_project_api_keys_list",
    title: "Cloud: project API keys",
    description: "Keys of a project (no secrets).",
    input: z.object({ projectId }),
    annotations: { readOnlyHint: true },
    run: ({ projectId }) =>
      api.cloud.get(p`/api/projects/${projectId}/api-keys`),
  });

  defineTool(server, {
    name: "cloud_project_api_key_create",
    title: "Cloud: create project API key",
    description: "Mints a scoped key. The secret is in this response only.",
    input: z.object({ projectId, ...createApiKeyInputSchema.shape }),
    annotations: { destructiveHint: true },
    run: ({ projectId, ...body }) =>
      api.cloud.post(p`/api/projects/${projectId}/api-keys`, body),
  });

  defineTool(server, {
    name: "cloud_project_api_key_rotate",
    title: "Cloud: rotate project API key",
    description:
      "Replaces the secret; the old one stops working. New secret in this response only.",
    input: z.object({ projectId, keyId: uuid }),
    annotations: { destructiveHint: true },
    run: ({ projectId, keyId }) =>
      api.cloud.post(p`/api/projects/${projectId}/api-keys/${keyId}/rotate`),
  });

  defineTool(server, {
    name: "cloud_project_api_key_delete",
    title: "Cloud: delete project API key",
    description: "Revokes a key.",
    input: z.object({ projectId, keyId: uuid }),
    annotations: { destructiveHint: true, idempotentHint: true },
    run: ({ projectId, keyId }) =>
      api.cloud.delete(p`/api/projects/${projectId}/api-keys/${keyId}`),
  });

  // Search collections -----------------------------------------------------

  defineTool(server, {
    name: "cloud_project_collections_list",
    title: "Cloud: search collections",
    description:
      "Meilisearch collections synced from a project's Mongo/Postgres sources.",
    input: z.object({ projectId }),
    annotations: { readOnlyHint: true },
    run: ({ projectId }) =>
      api.cloud.get(p`/api/projects/${projectId}/collections`),
  });

  defineTool(server, {
    name: "cloud_project_collection_get",
    title: "Cloud: search collection",
    description: "One collection with mapping and sync status.",
    input: z.object({ projectId, collectionId }),
    annotations: { readOnlyHint: true },
    run: ({ projectId, collectionId }) =>
      api.cloud.get(p`/api/projects/${projectId}/collections/${collectionId}`),
  });

  defineTool(server, {
    name: "cloud_project_collection_create",
    title: "Cloud: create search collection",
    description:
      "Adds a collection from a Mongo collection or Postgres table with a field mapping.",
    input: z.object({ projectId, collection: createCollectionInputSchema }),
    run: ({ projectId, collection }) =>
      api.cloud.post(p`/api/projects/${projectId}/collections`, collection),
  });

  defineTool(server, {
    name: "cloud_project_collection_update",
    title: "Cloud: update search collection",
    description: "Field mapping or sync flag.",
    input: z.object({
      projectId,
      collectionId,
      ...updateCollectionInputSchema.shape,
    }),
    annotations: { idempotentHint: true },
    run: ({ projectId, collectionId, ...body }) =>
      api.cloud.patch(
        p`/api/projects/${projectId}/collections/${collectionId}`,
        body,
      ),
  });

  defineTool(server, {
    name: "cloud_project_collection_delete",
    title: "Cloud: delete search collection",
    description: "Drops the collection and its index.",
    input: z.object({ projectId, collectionId }),
    annotations: { destructiveHint: true },
    run: ({ projectId, collectionId }) =>
      api.cloud.delete(
        p`/api/projects/${projectId}/collections/${collectionId}`,
      ),
  });

  defineTool(server, {
    name: "cloud_project_collection_resync",
    title: "Cloud: resync search collection",
    description: "Full re-index from the source.",
    input: z.object({ projectId, collectionId }),
    run: ({ projectId, collectionId }) =>
      api.cloud.post(
        p`/api/projects/${projectId}/collections/${collectionId}/resync`,
      ),
  });

  defineTool(server, {
    name: "cloud_project_collection_discover_fields",
    title: "Cloud: discover source fields",
    description:
      "Samples a Mongo collection or Postgres table and proposes a field mapping.",
    input: z.object({ projectId, source: discoverFieldsInputSchema }),
    annotations: { readOnlyHint: true },
    run: ({ projectId, source }) =>
      api.cloud.post(
        p`/api/projects/${projectId}/collections/discover-fields`,
        source,
      ),
  });

  defineTool(server, {
    name: "cloud_project_search_token",
    title: "Cloud: search token",
    description: "Mints a tenant search token for the project's collections.",
    input: z.object({ projectId, ...generateSearchTokenInputSchema.shape }),
    annotations: { destructiveHint: true },
    run: ({ projectId, ...body }) =>
      api.cloud.post(p`/api/projects/${projectId}/search-token`, body),
  });

  // Postgres introspection -------------------------------------------------

  const database = z.string().min(1).describe("Postgres database name");
  defineActions(server, {
    name: "cloud_project_pg_introspect",
    title: "Cloud: project Postgres introspection",
    description:
      "Read-only view of the Postgres databases a project can search from.",
    actions: {
      databases: action({
        description: "Databases visible to the project",
        input: z.object({ projectId }),
        readOnly: true,
        run: ({ projectId }) =>
          api.cloud.get(p`/api/projects/${projectId}/pg-databases`),
      }),
      schemas: action({
        description: "Schemas of a database",
        input: z.object({ projectId, database }),
        readOnly: true,
        run: ({ projectId, database }) =>
          api.cloud.get(p`/api/projects/${projectId}/pg-schemas`, { database }),
      }),
      tables: action({
        description: "Tables of a schema (default public)",
        input: z.object({ projectId, database, schema: z.string().optional() }),
        readOnly: true,
        run: ({ projectId, database, schema }) =>
          api.cloud.get(p`/api/projects/${projectId}/pg-tables`, {
            database,
            schema,
          }),
      }),
      columns: action({
        description: "Columns of a table",
        input: z.object({
          projectId,
          database,
          schema: z.string().min(1),
          table: z.string().min(1),
        }),
        readOnly: true,
        run: ({ projectId, database, schema, table }) =>
          api.cloud.get(
            p`/api/projects/${projectId}/pg-tables/${schema}/${table}/columns`,
            {
              database,
            },
          ),
      }),
    },
  });

  // Provisioned databases --------------------------------------------------

  defineTool(server, {
    name: "cloud_project_databases_list",
    title: "Cloud: project databases",
    description: "Postgres/Mongo databases provisioned for a project.",
    input: z.object({ projectId }),
    annotations: { readOnlyHint: true },
    run: ({ projectId }) =>
      api.cloud.get(p`/api/projects/${projectId}/databases`),
  });

  defineTool(server, {
    name: "cloud_project_database_provision",
    title: "Cloud: provision project database",
    description:
      "Creates a database and role for the project; credentials are in this response only.",
    input: z.object({ projectId, ...provisionDatabaseInputSchema.shape }),
    annotations: { destructiveHint: true },
    run: ({ projectId, ...body }) =>
      api.cloud.post(p`/api/projects/${projectId}/databases`, body),
  });

  defineTool(server, {
    name: "cloud_project_database_delete",
    title: "Cloud: drop project database",
    description: "Drops the database and its role.",
    input: z.object({ projectId, databaseId: uuid }),
    annotations: { destructiveHint: true },
    run: ({ projectId, databaseId }) =>
      api.cloud.delete(p`/api/projects/${projectId}/databases/${databaseId}`),
  });

  // S3 credentials ---------------------------------------------------------

  defineTool(server, {
    name: "cloud_project_s3_credentials_list",
    title: "Cloud: project S3 credentials",
    description: "Access keys scoped to the project's bucket (no secrets).",
    input: z.object({ projectId }),
    annotations: { readOnlyHint: true },
    run: ({ projectId }) =>
      api.cloud.get(p`/api/projects/${projectId}/s3-credentials`),
  });

  defineTool(server, {
    name: "cloud_project_s3_credential_create",
    title: "Cloud: create project S3 credential",
    description:
      "Issues an access key pair for the project bucket. Secret in this response only.",
    input: z.object({
      projectId,
      ...createProjectS3CredentialInputSchema.shape,
    }),
    annotations: { destructiveHint: true },
    run: ({ projectId, ...body }) =>
      api.cloud.post(p`/api/projects/${projectId}/s3-credentials`, body),
  });

  defineTool(server, {
    name: "cloud_project_s3_credential_rotate",
    title: "Cloud: rotate project S3 credential",
    description:
      "New secret for an existing access key id. Secret in this response only.",
    input: z.object({ projectId, credentialId: uuid }),
    annotations: { destructiveHint: true },
    run: ({ projectId, credentialId }) =>
      api.cloud.post(
        p`/api/projects/${projectId}/s3-credentials/${credentialId}/rotate`,
      ),
  });

  defineTool(server, {
    name: "cloud_project_s3_credential_delete",
    title: "Cloud: delete project S3 credential",
    description: "Revokes the access key.",
    input: z.object({ projectId, credentialId: uuid }),
    annotations: { destructiveHint: true, idempotentHint: true },
    run: ({ projectId, credentialId }) =>
      api.cloud.delete(
        p`/api/projects/${projectId}/s3-credentials/${credentialId}`,
      ),
  });

  // Vector indexes ---------------------------------------------------------

  defineTool(server, {
    name: "cloud_project_vector_indexes_list",
    title: "Cloud: project vector indexes",
    description: "Mongo vector search indexes of a project with build state.",
    input: z.object({ projectId }),
    annotations: { readOnlyHint: true },
    run: ({ projectId }) =>
      api.cloud.get(p`/api/projects/${projectId}/vector-indexes`),
  });

  defineTool(server, {
    name: "cloud_project_vector_index_create",
    title: "Cloud: create vector index",
    description: "Builds a vector index on a Mongo collection (async, 202).",
    input: z.object({
      projectId,
      ...createProjectVectorIndexInputSchema.shape,
    }),
    run: ({ projectId, ...body }) =>
      api.cloud.post(p`/api/projects/${projectId}/vector-indexes`, body),
  });

  defineTool(server, {
    name: "cloud_project_vector_index_delete",
    title: "Cloud: delete vector index",
    description: "Drops a vector index.",
    input: z.object({
      projectId,
      collection: z.string().min(1),
      indexName: z.string().min(1),
    }),
    annotations: { destructiveHint: true, idempotentHint: true },
    run: ({ projectId, collection, indexName }) =>
      api.cloud.delete(
        p`/api/projects/${projectId}/vector-indexes/${collection}/${indexName}`,
      ),
  });
}
