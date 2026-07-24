import {
  type AuthVariables,
  CloudCoreError,
  createApiKey,
  createCollection,
  createProject,
  createProjectIndex,
  createProjectSearchKey,
  createProjectVectorIndex,
  type Database,
  deleteAllProjectIndexes,
  deleteCollection,
  deleteProject,
  deleteProjectIndex,
  deleteProjectSearchKey,
  deleteProjectVectorIndex,
  deprovisionProjectDatabase,
  dropPgTrigger,
  ensureOutboxTable,
  generateProjectToken,
  getCollection,
  getProject,
  getProjectVectorSearchOverview,
  installPgTrigger,
  issueS3Credential,
  listApiKeys,
  listCollections,
  listProjectDatabases,
  listProjectS3Credentials,
  listProjects,
  type MeiliSearch,
  type ProjectDatabaseHosts,
  type ProjectPgClientFactory,
  type Provisioner,
  provisionProjectDatabase,
  requireRole,
  requireScope,
  requireSession,
  revokeApiKey,
  revokeProjectS3Credential,
  rotateApiKey,
  type S3CredentialResolver,
  type SyncWorker,
  scopedIndexName,
  updateCollection,
  updateProject,
} from "@repo/cloud-core";
import { projectDatabases, projects } from "@repo/cloud-core/db/schema";
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
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { MongoClient } from "mongodb";

interface ProjectRouteOptions {
  db: Database;
  meili: MeiliSearch;
  mongo: MongoClient;
  syncWorker: SyncWorker;
  pgClientFactory: ProjectPgClientFactory;
  provisioners: ReadonlyMap<"postgres" | "mongodb" | "redis", Provisioner>;
  databaseEncryptionSecret: string;
  databaseHosts: ProjectDatabaseHosts;
  s3CredentialEncryptionKey: string;
  s3CredentialResolver: Pick<S3CredentialResolver, "invalidate">;
  mongotHealthUrl: string;
  mongotMaxIndexesPerProject: number;
}

function errorResponse(error: unknown) {
  if (error instanceof CloudCoreError) {
    return {
      body: { error: { code: error.code, message: error.message } },
      status: error.status,
    } as const;
  }
  return null;
}

function parseExpiration(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const duration = {
    "30d": 30 * 24 * 60 * 60 * 1_000,
    "90d": 90 * 24 * 60 * 60 * 1_000,
    "1y": 365 * 24 * 60 * 60 * 1_000,
  }[value];
  return duration ? new Date(Date.now() + duration) : undefined;
}

function projectScopeGuard() {
  return async (
    context: Parameters<ReturnType<typeof requireScope>>[0],
    next: () => Promise<void>,
  ) => {
    const authenticatedProject = context.get("project");
    if (
      authenticatedProject &&
      authenticatedProject.id !== context.req.param("id")
    ) {
      return context.json(
        {
          error: {
            code: "PROJECT_SCOPE_MISMATCH",
            message: "API key is not valid for this project",
          },
        },
        403,
      );
    }
    return next();
  };
}

function superuserOrScope(scope: "storage:manage") {
  return async (
    context: Parameters<ReturnType<typeof requireScope>>[0],
    next: () => Promise<void>,
  ) => {
    if (context.get("sessionId") !== undefined) {
      if (context.get("user").role !== "superuser") {
        return context.json(
          {
            error: {
              code: "FORBIDDEN",
              message: "Superuser access is required",
            },
          },
          403,
        );
      }
      return next();
    }
    const scopes = context.get("scopes") ?? [];
    if (!scopes.includes(scope)) {
      return context.json(
        {
          error: {
            code: "INSUFFICIENT_SCOPE",
            message: `Required scopes: ${scope}`,
          },
        },
        403,
      );
    }
    return next();
  };
}

async function ensureMeiliKey(
  db: Database,
  meili: MeiliSearch,
  projectId: string,
  projectSlug: string,
): Promise<{ apiKey: string; apiKeyUid: string }> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`meili:${projectId}`}, 0))`,
    );
    const project = await tx.query.projects.findFirst({
      where: eq(projects.id, projectId),
    });
    if (!project) {
      throw new CloudCoreErrorImpl("Project not found", "PROJECT_NOT_FOUND");
    }
    if (project.meiliApiKey && project.meiliApiKeyUid) {
      return {
        apiKey: project.meiliApiKey,
        apiKeyUid: project.meiliApiKeyUid,
      };
    }
    const { key, uid } = await createProjectSearchKey(meili, projectSlug);
    try {
      await tx
        .update(projects)
        .set({ meiliApiKey: key, meiliApiKeyUid: uid, updatedAt: new Date() })
        .where(eq(projects.id, projectId));
      return { apiKey: key, apiKeyUid: uid };
    } catch (error) {
      await deleteProjectSearchKey(meili, uid).catch(() => undefined);
      throw error;
    }
  });
}

async function requireOwnedCollection(
  db: Database,
  projectId: string,
  collectionId: string,
) {
  const collection = await getCollection(db, collectionId);
  if (collection.projectId !== projectId) {
    throw new CloudCoreErrorImpl(
      "Collection not found",
      "COLLECTION_NOT_FOUND",
    );
  }
  return collection;
}

class CloudCoreErrorImpl extends CloudCoreError {
  readonly status = 404 as const;
}

async function assertProjectDatabase(
  db: Database,
  projectId: string,
  type: "postgres" | "mongodb",
  database: string,
): Promise<void> {
  const record = await db.query.projectDatabases.findFirst({
    columns: { id: true },
    where: and(
      eq(projectDatabases.projectId, projectId),
      eq(projectDatabases.type, type),
      eq(projectDatabases.dbName, database),
    ),
  });
  if (!record) {
    throw new CloudCoreErrorImpl(
      `${type === "postgres" ? "Postgres" : "MongoDB"} database not found`,
      "DATABASE_NOT_FOUND",
    );
  }
}

export function projectRoutes(options: ProjectRouteOptions) {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.use("/:id/*", projectScopeGuard());

  app.get("/", requireSession(), requireRole("superuser"), async (context) => {
    const page = Number(context.req.query("page") ?? 1);
    const limit = Number(context.req.query("limit") ?? 50);
    if (
      !Number.isInteger(page) ||
      !Number.isInteger(limit) ||
      page < 1 ||
      limit < 1 ||
      limit > 100
    ) {
      return context.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Invalid pagination parameters",
          },
        },
        400,
      );
    }
    const result = await listProjects(options.db, { page, limit });
    return context.json({
      data: result.projects,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    });
  });

  app.post("/", requireSession(), requireRole("superuser"), async (context) => {
    const parsed = createProjectInputSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return context.json(
        { error: { code: "INVALID_INPUT", message: "Invalid project" } },
        400,
      );
    }
    const project = await createProject(options.db, {
      ...parsed.data,
      ownerId: context.get("user").id,
      storageRootPath: `/${parsed.data.slug}`,
    });
    return context.json({ data: project }, 201);
  });

  app.get("/:id", requireSession(), requireRole("superuser"), async (context) =>
    context.json({
      data: await getProject(options.db, context.req.param("id")),
    }),
  );

  app.patch(
    "/:id",
    requireSession(),
    requireRole("superuser"),
    async (context) => {
      const parsed = updateProjectInputSchema.safeParse(
        await context.req.json().catch(() => null),
      );
      if (!parsed.success || Object.keys(parsed.data).length === 0) {
        return context.json(
          {
            error: { code: "INVALID_INPUT", message: "Invalid project update" },
          },
          400,
        );
      }
      const project = await updateProject(
        options.db,
        context.req.param("id"),
        parsed.data,
      );
      return context.json({ data: project });
    },
  );

  app.delete(
    "/:id",
    requireSession(),
    requireRole("superuser"),
    async (context) => {
      const projectId = context.req.param("id");
      const project = await getProject(options.db, projectId);
      const collections = await listCollections(options.db, projectId);
      for (const collection of collections) {
        await options.syncWorker.removeCollection(collection.id);
        if (
          collection.sourceType === "postgres" &&
          collection.pgSchema &&
          collection.pgTable
        ) {
          const client =
            await options.pgClientFactory.forCollection(collection);
          try {
            await dropPgTrigger(
              client.sql,
              collection.pgSchema,
              collection.pgTable,
            );
          } finally {
            await client.close();
          }
        }
      }
      const databases = await listProjectDatabases(options.db, projectId);
      for (const database of databases) {
        await deprovisionProjectDatabase(
          options.db,
          options.provisioners,
          projectId,
          database.id,
        );
      }
      if (project.meiliApiKeyUid) {
        await deleteAllProjectIndexes(options.meili, project.slug).catch(
          () => undefined,
        );
        await deleteProjectSearchKey(
          options.meili,
          project.meiliApiKeyUid,
        ).catch(() => undefined);
      }
      await deleteProject(options.db, projectId);
      options.s3CredentialResolver.invalidate();
      return context.json({ data: { success: true } });
    },
  );

  app.get(
    "/:id/api-keys",
    requireSession(),
    requireRole("superuser"),
    async (context) => {
      const projectId = context.req.param("id");
      await getProject(options.db, projectId);
      return context.json({ data: await listApiKeys(options.db, projectId) });
    },
  );

  app.post(
    "/:id/api-keys",
    requireSession(),
    requireRole("superuser"),
    async (context) => {
      const projectId = context.req.param("id");
      await getProject(options.db, projectId);
      const parsed = createApiKeyInputSchema.safeParse(
        await context.req.json().catch(() => null),
      );
      if (!parsed.success) {
        return context.json(
          { error: { code: "INVALID_INPUT", message: "Invalid API key" } },
          400,
        );
      }
      const created = await createApiKey(options.db, {
        userId: context.get("user").id,
        projectId,
        name: parsed.data.name,
        scopes: parsed.data.scopes,
        expiresAt: parseExpiration(parsed.data.expiresIn),
      });
      return context.json({ data: created }, 201);
    },
  );

  app.delete(
    "/:id/api-keys/:keyId",
    requireSession(),
    requireRole("superuser"),
    async (context) => {
      await revokeApiKey(
        options.db,
        context.req.param("keyId"),
        context.req.param("id"),
      );
      return context.json({ data: { success: true } });
    },
  );

  app.post(
    "/:id/api-keys/:keyId/rotate",
    requireSession(),
    requireRole("superuser"),
    async (context) => {
      const rotated = await rotateApiKey(
        options.db,
        context.req.param("keyId"),
        context.req.param("id"),
      );
      return context.json({ data: rotated }, 201);
    },
  );

  app.get("/:id/collections", requireScope("search:read"), async (context) => {
    const projectId = context.req.param("id");
    await getProject(options.db, projectId);
    return context.json({
      data: await listCollections(options.db, projectId),
    });
  });

  app.post(
    "/:id/collections",
    requireScope("search:manage"),
    async (context) => {
      const project = await getProject(options.db, context.req.param("id"));
      const parsed = createCollectionInputSchema.safeParse(
        await context.req.json().catch(() => null),
      );
      if (!parsed.success) {
        return context.json(
          { error: { code: "INVALID_INPUT", message: "Invalid collection" } },
          400,
        );
      }
      await ensureMeiliKey(options.db, options.meili, project.id, project.slug);
      const input = parsed.data;
      await assertProjectDatabase(
        options.db,
        project.id,
        input.sourceType,
        input.sourceType === "postgres"
          ? input.pgDatabase
          : input.mongoDatabase,
      );
      const collection = await createCollection(options.db, {
        ...input,
        projectId: project.id,
        meiliIndexUid: scopedIndexName(project.slug, input.name),
      });
      try {
        await createProjectIndex(
          options.meili,
          project.slug,
          input.name,
          input.fieldMapping?.primaryKey ?? "id",
        );
        if (collection.sourceType === "postgres") {
          const client =
            await options.pgClientFactory.forCollection(collection);
          try {
            await ensureOutboxTable(client.sql);
            await installPgTrigger(
              client.sql,
              collection.pgSchema!,
              collection.pgTable!,
              collection.pgIdColumn!,
            );
          } finally {
            await client.close();
          }
        }
      } catch (error) {
        await deleteProjectIndex(options.meili, project.slug, input.name).catch(
          () => undefined,
        );
        await deleteCollection(options.db, collection.id).catch(
          () => undefined,
        );
        throw error;
      }
      await options.syncWorker.addCollection(collection);
      return context.json({ data: collection }, 201);
    },
  );

  app.get(
    "/:id/collections/:collectionId",
    requireScope("search:read"),
    async (context) => {
      const collection = await requireOwnedCollection(
        options.db,
        context.req.param("id"),
        context.req.param("collectionId"),
      );
      return context.json({ data: collection });
    },
  );

  app.patch(
    "/:id/collections/:collectionId",
    requireScope("search:manage"),
    async (context) => {
      const collectionId = context.req.param("collectionId");
      const existing = await requireOwnedCollection(
        options.db,
        context.req.param("id"),
        collectionId,
      );
      const parsed = updateCollectionInputSchema.safeParse(
        await context.req.json().catch(() => null),
      );
      if (!parsed.success || Object.keys(parsed.data).length === 0) {
        return context.json(
          {
            error: {
              code: "INVALID_INPUT",
              message: "Invalid collection update",
            },
          },
          400,
        );
      }
      const updated = await updateCollection(
        options.db,
        collectionId,
        parsed.data,
      );
      if (parsed.data.fieldMapping) {
        await options.meili
          .index(existing.meiliIndexUid)
          .updateSettings({
            searchableAttributes: parsed.data.fieldMapping
              .searchableAttributes ?? ["*"],
            filterableAttributes:
              parsed.data.fieldMapping.filterableAttributes ?? [],
            sortableAttributes:
              parsed.data.fieldMapping.sortableAttributes ?? [],
          })
          .waitTask();
        await options.syncWorker.resyncCollection(collectionId);
      }
      if (parsed.data.syncEnabled === true && !existing.syncEnabled) {
        await options.syncWorker.addCollection(updated);
      } else if (parsed.data.syncEnabled === false && existing.syncEnabled) {
        await options.syncWorker.removeCollection(collectionId);
      }
      return context.json({ data: updated });
    },
  );

  app.delete(
    "/:id/collections/:collectionId",
    requireScope("search:manage"),
    async (context) => {
      const collection = await requireOwnedCollection(
        options.db,
        context.req.param("id"),
        context.req.param("collectionId"),
      );
      await options.syncWorker.removeCollection(collection.id);
      if (
        collection.sourceType === "postgres" &&
        collection.pgSchema &&
        collection.pgTable
      ) {
        const client = await options.pgClientFactory.forCollection(collection);
        try {
          await dropPgTrigger(
            client.sql,
            collection.pgSchema,
            collection.pgTable,
          );
        } finally {
          await client.close();
        }
      }
      await options.meili
        .deleteIndex(collection.meiliIndexUid)
        .waitTask()
        .catch(() => undefined);
      await deleteCollection(options.db, collection.id);
      return context.json({ data: { success: true } });
    },
  );

  app.post(
    "/:id/collections/:collectionId/resync",
    requireScope("search:manage"),
    async (context) => {
      const collection = await requireOwnedCollection(
        options.db,
        context.req.param("id"),
        context.req.param("collectionId"),
      );
      await options.syncWorker.resyncCollection(collection.id);
      return context.json({
        data: { success: true, message: "Resync started" },
      });
    },
  );

  app.post(
    "/:id/search-token",
    requireScope("search:read"),
    async (context) => {
      const project = await getProject(options.db, context.req.param("id"));
      if (!project.meiliApiKey || !project.meiliApiKeyUid) {
        return context.json(
          {
            error: {
              code: "SEARCH_NOT_CONFIGURED",
              message: "Project has no search collections",
            },
          },
          400,
        );
      }
      const parsed = generateSearchTokenInputSchema.safeParse(
        await context.req.json().catch(() => ({})),
      );
      if (!parsed.success) {
        return context.json(
          {
            error: { code: "INVALID_INPUT", message: "Invalid token request" },
          },
          400,
        );
      }
      const expiresAt = new Date(
        Date.now() +
          Math.min(parsed.data.expiresInHours ?? 24, 720) * 60 * 60 * 1_000,
      );
      const token = await generateProjectToken({
        apiKey: project.meiliApiKey,
        apiKeyUid: project.meiliApiKeyUid,
        projectName: project.slug,
        searchRules: parsed.data.searchRules,
        expiresAt,
      });
      return context.json({
        data: { token, expiresAt: expiresAt.toISOString() },
      });
    },
  );

  app.get("/:id/pg-databases", requireScope("search:read"), async (context) => {
    const projectId = context.req.param("id");
    await getProject(options.db, projectId);
    const records = await options.db
      .select({ name: projectDatabases.dbName })
      .from(projectDatabases)
      .where(
        and(
          eq(projectDatabases.projectId, projectId),
          eq(projectDatabases.type, "postgres"),
        ),
      );
    return context.json({ data: records });
  });

  app.get("/:id/pg-schemas", requireScope("search:read"), async (context) => {
    const projectId = context.req.param("id");
    const database = context.req.query("database");
    if (!database || !/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(database)) {
      return context.json(
        { error: { code: "INVALID_INPUT", message: "Invalid database" } },
        400,
      );
    }
    await assertProjectDatabase(options.db, projectId, "postgres", database);
    const client = await options.pgClientFactory.forDatabase(database);
    try {
      const rows = await client.sql<Array<{ name: string }>>`
          SELECT nspname AS name
          FROM pg_namespace
          WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
            AND nspname NOT LIKE 'pg_temp_%'
            AND nspname NOT LIKE 'pg_toast_temp_%'
          ORDER BY nspname
        `;
      return context.json({ data: rows });
    } finally {
      await client.close();
    }
  });

  app.get("/:id/pg-tables", requireScope("search:read"), async (context) => {
    const projectId = context.req.param("id");
    const database = context.req.query("database");
    const schema = context.req.query("schema") ?? "public";
    const identifier = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;
    if (!database || !identifier.test(database) || !identifier.test(schema)) {
      return context.json(
        { error: { code: "INVALID_INPUT", message: "Invalid identifiers" } },
        400,
      );
    }
    await assertProjectDatabase(options.db, projectId, "postgres", database);
    const client = await options.pgClientFactory.forDatabase(database);
    try {
      const rows = await client.sql<Array<{ name: string }>>`
          SELECT tablename AS name
          FROM pg_tables
          WHERE schemaname = ${schema} AND tablename <> '_meili_outbox'
          ORDER BY tablename
        `;
      return context.json({ data: rows });
    } finally {
      await client.close();
    }
  });

  app.get(
    "/:id/pg-tables/:schema/:table/columns",
    requireScope("search:read"),
    async (context) => {
      const projectId = context.req.param("id");
      const database = context.req.query("database");
      const schema = context.req.param("schema");
      const table = context.req.param("table");
      const identifier = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;
      if (
        !database ||
        !identifier.test(database) ||
        !identifier.test(schema) ||
        !identifier.test(table)
      ) {
        return context.json(
          { error: { code: "INVALID_INPUT", message: "Invalid identifiers" } },
          400,
        );
      }
      await assertProjectDatabase(options.db, projectId, "postgres", database);
      const client = await options.pgClientFactory.forDatabase(database);
      try {
        const [columns, primaryKeys] = await Promise.all([
          client.sql<Array<{ name: string; type: string; nullable: boolean }>>`
            SELECT a.attname AS name,
                   format_type(a.atttypid, a.atttypmod) AS type,
                   NOT a.attnotnull AS nullable
            FROM pg_attribute a
            JOIN pg_class c ON c.oid = a.attrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = ${schema}
              AND c.relname = ${table}
              AND a.attnum > 0
              AND NOT a.attisdropped
            ORDER BY a.attnum
          `,
          client.sql<Array<{ column: string }>>`
            SELECT a.attname AS column
            FROM pg_index i
            JOIN pg_class c ON c.oid = i.indrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            JOIN pg_attribute a
              ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
            WHERE n.nspname = ${schema}
              AND c.relname = ${table}
              AND i.indisprimary
          `,
        ]);
        const primaryKey = primaryKeys.map((row) => row.column);
        return context.json({
          data: {
            columns: columns.map((column) => ({
              ...column,
              isPrimaryKey: primaryKey.includes(column.name),
            })),
            primaryKey,
          },
        });
      } finally {
        await client.close();
      }
    },
  );

  app.post(
    "/:id/collections/discover-fields",
    requireScope("search:read"),
    async (context) => {
      const projectId = context.req.param("id");
      const parsed = discoverFieldsInputSchema.safeParse(
        await context.req.json().catch(() => null),
      );
      if (!parsed.success) {
        return context.json(
          { error: { code: "INVALID_INPUT", message: "Invalid source" } },
          400,
        );
      }
      if (parsed.data.sourceType === "postgres") {
        await assertProjectDatabase(
          options.db,
          projectId,
          "postgres",
          parsed.data.pgDatabase,
        );
        const client = await options.pgClientFactory.forDatabase(
          parsed.data.pgDatabase,
        );
        try {
          const rows = await client.sql<Array<{ name: string; type: string }>>`
            SELECT a.attname AS name,
                   format_type(a.atttypid, a.atttypmod) AS type
            FROM pg_attribute a
            JOIN pg_class c ON c.oid = a.attrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = ${parsed.data.pgSchema}
              AND c.relname = ${parsed.data.pgTable}
              AND a.attnum > 0
              AND NOT a.attisdropped
            ORDER BY a.attnum
          `;
          return context.json({
            data: {
              fields: rows.map((row) => ({
                name: row.name,
                types: [row.type],
              })),
              sampleCount: rows.length,
            },
          });
        } finally {
          await client.close();
        }
      }
      await assertProjectDatabase(
        options.db,
        projectId,
        "mongodb",
        parsed.data.mongoDatabase,
      );
      const sample = await options.mongo
        .db(parsed.data.mongoDatabase)
        .collection(parsed.data.mongoCollection)
        .find()
        .limit(100)
        .toArray();
      const fieldTypes = new Map<string, Set<string>>();
      for (const document of sample) {
        for (const [field, value] of Object.entries(document)) {
          if (field === "_id") continue;
          const types = fieldTypes.get(field) ?? new Set<string>();
          types.add(
            value === null
              ? "null"
              : Array.isArray(value)
                ? "array"
                : typeof value,
          );
          fieldTypes.set(field, types);
        }
      }
      return context.json({
        data: {
          fields: [...fieldTypes].map(([name, types]) => ({
            name,
            types: [...types],
          })),
          sampleCount: sample.length,
        },
      });
    },
  );

  app.get(
    "/:id/databases",
    requireSession(),
    requireRole("superuser"),
    async (context) =>
      context.json({
        data: await listProjectDatabases(options.db, context.req.param("id")),
      }),
  );

  app.post(
    "/:id/databases",
    requireSession(),
    requireRole("superuser"),
    async (context) => {
      const parsed = provisionDatabaseInputSchema.safeParse(
        await context.req.json().catch(() => null),
      );
      if (!parsed.success) {
        return context.json(
          {
            error: { code: "INVALID_INPUT", message: "Invalid database type" },
          },
          400,
        );
      }
      const database = await provisionProjectDatabase(
        options.db,
        options.provisioners,
        options.databaseEncryptionSecret,
        options.databaseHosts,
        { projectId: context.req.param("id"), type: parsed.data.type },
      );
      return context.json({ data: database }, 201);
    },
  );

  app.delete(
    "/:id/databases/:databaseId",
    requireSession(),
    requireRole("superuser"),
    async (context) => {
      await deprovisionProjectDatabase(
        options.db,
        options.provisioners,
        context.req.param("id"),
        context.req.param("databaseId"),
      );
      return context.json({ data: null });
    },
  );

  app.get(
    "/:id/s3-credentials",
    superuserOrScope("storage:manage"),
    async (context) => {
      const projectId = context.req.param("id");
      await getProject(options.db, projectId);
      return context.json({
        data: await listProjectS3Credentials(options.db, projectId),
      });
    },
  );

  app.post(
    "/:id/s3-credentials",
    superuserOrScope("storage:manage"),
    async (context) => {
      const projectId = context.req.param("id");
      await getProject(options.db, projectId);
      const parsed = createProjectS3CredentialInputSchema.safeParse(
        await context.req.json().catch(() => null),
      );
      if (!parsed.success) {
        return context.json(
          {
            error: {
              code: "INVALID_INPUT",
              message: "Invalid credential label",
            },
          },
          400,
        );
      }
      const issued = await issueS3Credential(options.db, {
        projectId,
        label: parsed.data.label,
        keyEncryptionSecret: options.s3CredentialEncryptionKey,
      });
      options.s3CredentialResolver.invalidate(issued.credential.accessKeyId);
      return context.json(
        {
          data: {
            id: issued.credential.id,
            projectId,
            accessKeyId: issued.credential.accessKeyId,
            secretAccessKey: issued.secretAccessKey,
            label: issued.credential.label,
            createdAt: issued.credential.createdAt,
            lastUsedAt: issued.credential.lastUsedAt,
            revokedAt: issued.credential.revokedAt,
          },
        },
        201,
      );
    },
  );

  app.post(
    "/:id/s3-credentials/:credentialId/rotate",
    superuserOrScope("storage:manage"),
    async (context) => {
      const projectId = context.req.param("id");
      const credentials = await listProjectS3Credentials(options.db, projectId);
      const existing = credentials.find(
        (credential) => credential.id === context.req.param("credentialId"),
      );
      if (!existing) {
        return context.json(
          { error: { code: "NOT_FOUND", message: "S3 credential not found" } },
          404,
        );
      }
      const issued = await issueS3Credential(options.db, {
        projectId,
        label: existing.label,
        keyEncryptionSecret: options.s3CredentialEncryptionKey,
      });
      try {
        await revokeProjectS3Credential(options.db, projectId, existing.id);
      } catch (error) {
        await revokeProjectS3Credential(
          options.db,
          projectId,
          issued.credential.id,
        ).catch(() => undefined);
        throw error;
      }
      options.s3CredentialResolver.invalidate(existing.accessKeyId);
      options.s3CredentialResolver.invalidate(issued.credential.accessKeyId);
      return context.json({
        data: {
          id: issued.credential.id,
          projectId,
          accessKeyId: issued.credential.accessKeyId,
          secretAccessKey: issued.secretAccessKey,
          label: issued.credential.label,
          createdAt: issued.credential.createdAt,
          lastUsedAt: issued.credential.lastUsedAt,
          revokedAt: issued.credential.revokedAt,
        },
      });
    },
  );

  app.delete(
    "/:id/s3-credentials/:credentialId",
    superuserOrScope("storage:manage"),
    async (context) => {
      const revoked = await revokeProjectS3Credential(
        options.db,
        context.req.param("id"),
        context.req.param("credentialId"),
      );
      options.s3CredentialResolver.invalidate(revoked.accessKeyId);
      return context.json({ data: { revoked: true } });
    },
  );

  app.get(
    "/:id/vector-indexes",
    requireSession(),
    requireRole("superuser"),
    async (context) =>
      context.json({
        data: await getProjectVectorSearchOverview(
          options.db,
          options.mongo,
          context.req.param("id"),
          options.mongotHealthUrl,
          options.mongotMaxIndexesPerProject,
        ),
      }),
  );

  app.post(
    "/:id/vector-indexes",
    requireSession(),
    requireRole("superuser"),
    async (context) => {
      const parsed = createProjectVectorIndexInputSchema.safeParse(
        await context.req.json().catch(() => null),
      );
      if (!parsed.success) {
        return context.json(
          { error: { code: "INVALID_INPUT", message: "Invalid vector index" } },
          400,
        );
      }
      const health = await getProjectVectorSearchOverview(
        options.db,
        options.mongo,
        context.req.param("id"),
        options.mongotHealthUrl,
        options.mongotMaxIndexesPerProject,
      );
      if (health.mongot.status !== "ready") {
        return context.json(
          {
            error: {
              code: "MONGOT_UNAVAILABLE",
              message: health.mongot.message ?? "mongot is unavailable",
            },
          },
          503,
        );
      }
      const created = await createProjectVectorIndex(
        options.db,
        options.mongo,
        context.req.param("id"),
        parsed.data,
        options.mongotMaxIndexesPerProject,
      );
      return context.json({ data: created }, 202);
    },
  );

  app.delete(
    "/:id/vector-indexes/:collection/:indexName",
    requireSession(),
    requireRole("superuser"),
    async (context) => {
      const identifier = /^[A-Za-z_][A-Za-z0-9_.-]{0,119}$/;
      const collection = context.req.param("collection");
      const indexName = context.req.param("indexName");
      if (
        !identifier.test(collection) ||
        !identifier.test(indexName) ||
        collection.includes("$") ||
        indexName.includes("$")
      ) {
        return context.json(
          { error: { code: "INVALID_INPUT", message: "Invalid index name" } },
          400,
        );
      }
      return context.json({
        data: await deleteProjectVectorIndex(
          options.db,
          options.mongo,
          context.req.param("id"),
          collection,
          indexName,
        ),
      });
    },
  );

  app.onError((error, context) => {
    const known = errorResponse(error);
    if (known) return context.json(known.body, known.status);
    console.error("Project route failed", error);
    return context.json(
      {
        error: {
          code: "PROJECT_OPERATION_FAILED",
          message: "Project operation failed",
        },
      },
      500,
    );
  });

  return app;
}
