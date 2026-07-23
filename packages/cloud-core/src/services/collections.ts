import { and, eq, type SQL, sql } from "drizzle-orm";

import type { Database } from "../db";
import {
  type CollectionSourceType,
  type FieldMapping,
  projectCollections,
  projects,
  type SyncStatus,
} from "../db/schema";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { isPostgresErrorCode } from "./database-errors";
import type { SafeProjectCollectionRecord } from "./types";

const MAX_SYNCED_COLLECTIONS = 20;

export interface CreateCollectionInput {
  projectId: string;
  name: string;
  sourceType: CollectionSourceType;
  meiliIndexUid: string;
  fieldMapping?: FieldMapping;
  mongoDatabase?: string;
  mongoCollection?: string;
  pgDatabase?: string;
  pgSchema?: string;
  pgTable?: string;
  pgIdColumn?: string;
}

interface SyncStatusUpdate {
  syncStatus?: SyncStatus;
  lastError?: string | null;
  lastSyncedAt?: Date | null;
  resumeToken?: Record<string, unknown> | null;
  pgOutboxCursor?: number;
  documentCount?: number;
  documentCountDelta?: number;
}

function validateCollectionSource(input: CreateCollectionInput): void {
  if (input.sourceType === "mongodb") {
    if (!input.mongoDatabase || !input.mongoCollection) {
      throw new ValidationError(
        "mongoDatabase and mongoCollection required for mongodb source",
        "INVALID_INPUT",
      );
    }
    return;
  }

  if (
    !input.pgDatabase ||
    !input.pgSchema ||
    !input.pgTable ||
    !input.pgIdColumn
  ) {
    throw new ValidationError(
      "pgDatabase, pgSchema, pgTable, pgIdColumn required for postgres source",
      "INVALID_INPUT",
    );
  }
}

async function lockProjectCollectionLimit(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  projectId: string,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${projectId}, 0))`,
  );
}

async function assertCollectionCapacity(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  projectId: string,
): Promise<void> {
  const [syncedCount] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(projectCollections)
    .where(
      and(
        eq(projectCollections.projectId, projectId),
        eq(projectCollections.syncEnabled, true),
      ),
    );

  if ((syncedCount?.count ?? 0) >= MAX_SYNCED_COLLECTIONS) {
    throw new ValidationError(
      `Maximum of ${MAX_SYNCED_COLLECTIONS} synced collections per project reached`,
      "COLLECTION_LIMIT_REACHED",
    );
  }
}

export async function createCollection(
  db: Database,
  input: CreateCollectionInput,
): Promise<SafeProjectCollectionRecord> {
  validateCollectionSource(input);

  try {
    return await db.transaction(async (tx) => {
      const project = await tx.query.projects.findFirst({
        where: eq(projects.id, input.projectId),
        columns: { id: true },
      });
      if (!project) {
        throw new NotFoundError("Project not found", "PROJECT_NOT_FOUND");
      }

      await lockProjectCollectionLimit(tx, input.projectId);
      await assertCollectionCapacity(tx, input.projectId);

      const [collection] = await tx
        .insert(projectCollections)
        .values({
          projectId: input.projectId,
          name: input.name,
          sourceType: input.sourceType,
          mongoDatabase: input.mongoDatabase ?? null,
          mongoCollection: input.mongoCollection ?? null,
          pgDatabase: input.pgDatabase ?? null,
          pgSchema: input.pgSchema ?? null,
          pgTable: input.pgTable ?? null,
          pgIdColumn: input.pgIdColumn ?? null,
          meiliIndexUid: input.meiliIndexUid,
          fieldMapping: input.fieldMapping ?? {},
        })
        .returning();

      if (!collection) {
        throw new Error("Failed to create collection");
      }
      return collection;
    });
  } catch (error) {
    if (isPostgresErrorCode(error, "23505")) {
      throw new ConflictError(
        "Collection name or search index already exists",
        "COLLECTION_EXISTS",
      );
    }
    throw error;
  }
}

export async function listCollections(
  db: Database,
  projectId: string,
): Promise<SafeProjectCollectionRecord[]> {
  return db
    .select()
    .from(projectCollections)
    .where(eq(projectCollections.projectId, projectId))
    .orderBy(projectCollections.createdAt);
}

export async function getCollection(
  db: Database,
  collectionId: string,
): Promise<SafeProjectCollectionRecord> {
  const collection = await db.query.projectCollections.findFirst({
    where: eq(projectCollections.id, collectionId),
  });

  if (!collection) {
    throw new NotFoundError("Collection not found", "COLLECTION_NOT_FOUND");
  }
  return collection;
}

export async function updateCollection(
  db: Database,
  collectionId: string,
  input: {
    fieldMapping?: FieldMapping;
    syncEnabled?: boolean;
  },
): Promise<SafeProjectCollectionRecord> {
  return db.transaction(async (tx) => {
    const existing = await tx.query.projectCollections.findFirst({
      where: eq(projectCollections.id, collectionId),
    });
    if (!existing) {
      throw new NotFoundError("Collection not found", "COLLECTION_NOT_FOUND");
    }

    if (input.syncEnabled === true && !existing.syncEnabled) {
      await lockProjectCollectionLimit(tx, existing.projectId);
      await assertCollectionCapacity(tx, existing.projectId);
    }

    const [updated] = await tx
      .update(projectCollections)
      .set({
        ...input,
        updatedAt: new Date(),
      })
      .where(eq(projectCollections.id, collectionId))
      .returning();

    if (!updated) {
      throw new NotFoundError("Collection not found", "COLLECTION_NOT_FOUND");
    }
    return updated;
  });
}

export async function deleteCollection(
  db: Database,
  collectionId: string,
): Promise<void> {
  const [deleted] = await db
    .delete(projectCollections)
    .where(eq(projectCollections.id, collectionId))
    .returning({ id: projectCollections.id });

  if (!deleted) {
    throw new NotFoundError("Collection not found", "COLLECTION_NOT_FOUND");
  }
}

export async function updateSyncStatus(
  db: Database,
  collectionId: string,
  status: SyncStatusUpdate,
): Promise<void> {
  const updates: {
    updatedAt: Date;
    syncStatus?: SyncStatus;
    lastError?: string | null;
    lastSyncedAt?: Date | null;
    resumeToken?: Record<string, unknown> | null;
    pgOutboxCursor?: number;
    documentCount?: number | SQL;
  } = {
    updatedAt: new Date(),
  };

  if (status.syncStatus !== undefined) updates.syncStatus = status.syncStatus;
  if (status.lastError !== undefined) updates.lastError = status.lastError;
  if (status.lastSyncedAt !== undefined)
    updates.lastSyncedAt = status.lastSyncedAt;
  if (status.resumeToken !== undefined)
    updates.resumeToken = status.resumeToken;
  if (status.pgOutboxCursor !== undefined) {
    updates.pgOutboxCursor = status.pgOutboxCursor;
  }
  if (status.documentCount !== undefined) {
    updates.documentCount = status.documentCount;
  }
  if (status.documentCountDelta !== undefined) {
    updates.documentCount = sql`greatest(
      0,
      ${projectCollections.documentCount} + ${status.documentCountDelta}
    )`;
  }

  const [updated] = await db
    .update(projectCollections)
    .set(updates)
    .where(eq(projectCollections.id, collectionId))
    .returning({ id: projectCollections.id });

  if (!updated) {
    throw new NotFoundError("Collection not found", "COLLECTION_NOT_FOUND");
  }
}

export async function listEnabledCollections(
  db: Database,
): Promise<SafeProjectCollectionRecord[]> {
  return db
    .select()
    .from(projectCollections)
    .where(eq(projectCollections.syncEnabled, true));
}
