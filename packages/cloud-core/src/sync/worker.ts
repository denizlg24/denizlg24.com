import type { Meilisearch } from "meilisearch";
import type {
  ChangeStream,
  ChangeStreamDocument,
  ChangeStreamOptions,
  Document,
  MongoClient,
} from "mongodb";

import type { Database } from "../db";
import type { ProjectCollection } from "../db/schema";
import { coalesceIndexOperations, type IndexOperation } from "./batch";
import {
  dropTrigger,
  ensureOutboxTable,
  gcOutbox,
  getCurrentOutboxId,
  installTrigger,
  pollOutbox,
  snapshotTable,
  triggerName,
} from "./pg-outbox";
import { transformDocument, transformPgRow } from "./transform";

interface SyncWorkerDeps {
  db: Database;
  mongo: MongoClient;
  meili: Meilisearch;
  pgClientFactory?: PgClientFactory;
  batchDelayMs?: number;
  batchSize?: number;
  indexingDelayMs?: number;
  pgPollIntervalMs?: number;
}

export interface PgClientFactory {
  forCollection(collection: ProjectCollection): Promise<{
    sql: import("postgres").Sql;
    close: () => Promise<void>;
  }>;
}

interface BatchBuffer {
  operations: IndexOperation[];
  timer: ReturnType<typeof setTimeout> | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resumeTokenRecord(token: unknown): Record<string, unknown> {
  if (!isRecord(token)) {
    throw new Error("MongoDB returned an invalid resume token");
  }
  return token;
}

export class SyncWorker {
  private readonly streams = new Map<
    string,
    ChangeStream<Document, ChangeStreamDocument<Document>>
  >();
  private readonly pgPollers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly buffers = new Map<string, BatchBuffer>();
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly db: Database;
  private readonly mongo: MongoClient;
  private readonly meili: Meilisearch;
  private readonly pgClientFactory?: PgClientFactory;
  private readonly batchDelayMs: number;
  private readonly batchSize: number;
  private readonly indexingDelayMs: number;
  private readonly pgPollIntervalMs: number;
  private stopping = false;

  constructor(deps: SyncWorkerDeps) {
    this.db = deps.db;
    this.mongo = deps.mongo;
    this.meili = deps.meili;
    this.pgClientFactory = deps.pgClientFactory;
    this.batchDelayMs = deps.batchDelayMs ?? 500;
    this.batchSize = deps.batchSize ?? 100;
    this.indexingDelayMs = deps.indexingDelayMs ?? 50;
    this.pgPollIntervalMs = deps.pgPollIntervalMs ?? 2000;
  }

  async start(): Promise<void> {
    this.stopping = false;
    const { listEnabledCollections } = await import("../services/collections");
    const collections = await listEnabledCollections(this.db);

    for (const collection of collections.filter(
      (candidate) => candidate.syncStatus !== "error",
    )) {
      try {
        await this.addCollection(collection);
      } catch (error) {
        console.error(
          `[SyncWorker] Failed to start ${collection.name}:`,
          error,
        );
      }
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    for (const abortController of this.abortControllers.values()) {
      abortController.abort();
    }

    for (const [collectionId, buffer] of this.buffers) {
      if (buffer.timer) {
        clearTimeout(buffer.timer);
      }
      const collection = await this.getCollectionById(collectionId);
      if (collection) {
        await this.flushBuffer(collectionId, collection.meiliIndexUid);
      }
    }

    for (const stream of this.streams.values()) {
      try {
        await stream.close();
      } catch {
        // A stream can already be closed after an abort.
      }
    }
    for (const poller of this.pgPollers.values()) {
      clearTimeout(poller);
    }

    this.streams.clear();
    this.pgPollers.clear();
    this.buffers.clear();
    this.abortControllers.clear();
  }

  async addCollection(collection: ProjectCollection): Promise<void> {
    if (this.streams.has(collection.id) || this.pgPollers.has(collection.id)) {
      return;
    }
    if (collection.sourceType === "postgres") {
      await this.addPgCollection(collection);
      return;
    }

    if (!collection.resumeToken) {
      await this.initialSync(collection);
    }
    if (!collection.mongoDatabase || !collection.mongoCollection) {
      throw new Error(
        `Collection ${collection.id} missing mongo source fields`,
      );
    }

    const options: ChangeStreamOptions = {
      fullDocument: "updateLookup",
    };
    if (collection.resumeToken) {
      options.resumeAfter = collection.resumeToken;
    }

    const stream = this.mongo
      .db(collection.mongoDatabase)
      .collection<Document>(collection.mongoCollection)
      .watch([], options);
    const abortController = new AbortController();

    this.buffers.set(collection.id, {
      operations: [],
      timer: null,
    });
    this.streams.set(collection.id, stream);
    this.abortControllers.set(collection.id, abortController);
    void this.consumeStream(collection, stream, abortController.signal);
  }

  private async consumeStream(
    collection: ProjectCollection,
    stream: ChangeStream<Document, ChangeStreamDocument<Document>>,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      for await (const event of stream) {
        if (signal.aborted) {
          break;
        }
        try {
          await this.handleChangeEvent(collection, event);
        } catch (error) {
          console.error(
            `[SyncWorker] Failed to handle ${collection.name} event:`,
            error,
          );
        }
      }
    } catch (error) {
      if (signal.aborted) {
        return;
      }

      this.streams.delete(collection.id);
      this.abortControllers.delete(collection.id);
      const { updateSyncStatus } = await import("../services/collections");
      const invalidResumeToken =
        error instanceof Error &&
        (error.message.includes("resume token") ||
          error.message.includes("oplog"));

      if (invalidResumeToken) {
        await this.resyncCollection(collection.id);
        return;
      }

      await updateSyncStatus(this.db, collection.id, {
        syncStatus: "error",
        lastError: error instanceof Error ? error.message : String(error),
      });
      if (!this.stopping) {
        setTimeout(() => {
          void this.reconnect(collection.id);
        }, 5000);
      }
    }
  }

  async removeCollection(collectionId: string): Promise<void> {
    const abortController = this.abortControllers.get(collectionId);
    abortController?.abort();
    this.abortControllers.delete(collectionId);

    const stream = this.streams.get(collectionId);
    if (stream) {
      try {
        await stream.close();
      } catch {
        // A concurrent stream error can close it first.
      }
      this.streams.delete(collectionId);
    }

    const poller = this.pgPollers.get(collectionId);
    if (poller) {
      clearTimeout(poller);
      this.pgPollers.delete(collectionId);
    }

    const buffer = this.buffers.get(collectionId);
    if (buffer?.timer) {
      clearTimeout(buffer.timer);
    }
    this.buffers.delete(collectionId);
  }

  async resyncCollection(collectionId: string): Promise<void> {
    await this.removeCollection(collectionId);
    const { getCollection, updateSyncStatus } = await import(
      "../services/collections"
    );
    const collection = await getCollection(this.db, collectionId);

    await updateSyncStatus(this.db, collectionId, {
      syncStatus: "idle",
      resumeToken: null,
      pgOutboxCursor: 0,
      lastSyncedAt: null,
      lastError: null,
    });

    await this.addCollection({
      ...collection,
      resumeToken: null,
      pgOutboxCursor: 0,
      lastSyncedAt: null,
    });
  }

  private async addPgCollection(collection: ProjectCollection): Promise<void> {
    if (!this.pgClientFactory) {
      throw new Error("Postgres sync requires pgClientFactory");
    }
    this.assertPgSource(collection);

    if (collection.pgOutboxCursor === 0 && !collection.lastSyncedAt) {
      await this.initialPgSync(collection);
    }

    const abortController = new AbortController();
    this.abortControllers.set(collection.id, abortController);
    this.buffers.set(collection.id, {
      operations: [],
      timer: null,
    });

    const tick = async (): Promise<void> => {
      if (abortController.signal.aborted) {
        return;
      }
      try {
        await this.pollPgOnce(collection);
      } catch (error) {
        console.error(
          `[SyncWorker] PG poll failed for ${collection.name}:`,
          error,
        );
        const { updateSyncStatus } = await import("../services/collections");
        await updateSyncStatus(this.db, collection.id, {
          syncStatus: "error",
          lastError: error instanceof Error ? error.message : String(error),
        });
      }
      if (!abortController.signal.aborted) {
        this.pgPollers.set(
          collection.id,
          setTimeout(() => void tick(), this.pgPollIntervalMs),
        );
      }
    };

    this.pgPollers.set(
      collection.id,
      setTimeout(() => void tick(), this.pgPollIntervalMs),
    );
  }

  private assertPgSource(
    collection: ProjectCollection,
  ): asserts collection is ProjectCollection & {
    pgDatabase: string;
    pgSchema: string;
    pgTable: string;
    pgIdColumn: string;
  } {
    if (
      !collection.pgDatabase ||
      !collection.pgSchema ||
      !collection.pgTable ||
      !collection.pgIdColumn
    ) {
      throw new Error(
        `Collection ${collection.id} missing postgres source fields`,
      );
    }
  }

  private async initialPgSync(collection: ProjectCollection): Promise<void> {
    if (!this.pgClientFactory) {
      throw new Error("Postgres sync requires pgClientFactory");
    }
    this.assertPgSource(collection);

    const { updateSyncStatus } = await import("../services/collections");
    await updateSyncStatus(this.db, collection.id, { syncStatus: "syncing" });

    const { sql, close } = await this.pgClientFactory.forCollection(collection);
    try {
      await this.ensureCollectionIndex(collection);
      await ensureOutboxTable(sql);
      await installTrigger(
        sql,
        collection.pgSchema,
        collection.pgTable,
        collection.pgIdColumn,
      );
      const startCursor = await getCurrentOutboxId(
        sql,
        collection.pgSchema,
        collection.pgTable,
      );

      const index = this.meili.index(collection.meiliIndexUid);
      let documentCount = 0;
      await snapshotTable(
        sql,
        collection.pgSchema,
        collection.pgTable,
        collection.pgIdColumn,
        500,
        async (rows) => {
          await index.addDocuments(
            rows.map((row) =>
              transformPgRow(
                row,
                collection.pgIdColumn,
                collection.fieldMapping,
              ),
            ),
          );
          documentCount += rows.length;
          await this.delayIndexing();
        },
      );

      await updateSyncStatus(this.db, collection.id, {
        syncStatus: "idle",
        lastSyncedAt: new Date(),
        documentCount,
        pgOutboxCursor: startCursor,
        lastError: null,
      });
    } catch (error) {
      await updateSyncStatus(this.db, collection.id, {
        syncStatus: "error",
        lastError: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      await close();
    }
  }

  private async pollPgOnce(collection: ProjectCollection): Promise<void> {
    if (!this.pgClientFactory) {
      return;
    }
    this.assertPgSource(collection);

    const { getCollection, updateSyncStatus } = await import(
      "../services/collections"
    );
    const fresh = await getCollection(this.db, collection.id);
    if (!fresh.syncEnabled) {
      return;
    }
    this.assertPgSource(fresh);

    const { sql, close } = await this.pgClientFactory.forCollection(fresh);
    try {
      const events = await pollOutbox(
        sql,
        fresh.pgSchema,
        fresh.pgTable,
        fresh.pgOutboxCursor,
        this.batchSize,
      );
      if (events.length === 0) {
        return;
      }

      const operations: IndexOperation[] = [];
      for (const event of events) {
        if (event.op === "delete") {
          operations.push({ type: "delete", id: event.rowId });
        } else if (event.payload) {
          operations.push({
            type: "upsert",
            id: event.rowId,
            document: transformPgRow(
              event.payload,
              fresh.pgIdColumn,
              fresh.fieldMapping,
            ),
          });
        }
      }

      const { upserts, deletes } = coalesceIndexOperations(operations);
      const index = this.meili.index(fresh.meiliIndexUid);
      if (upserts.length > 0) {
        await index.addDocuments(upserts);
      }
      if (deletes.length > 0) {
        await index.deleteDocuments(deletes);
      }

      const lastEvent = events.at(-1);
      if (!lastEvent) {
        return;
      }
      await gcOutbox(sql, fresh.pgSchema, fresh.pgTable, lastEvent.id);

      const documentCountDelta = operations.reduce(
        (delta, operation) => delta + (operation.type === "upsert" ? 1 : -1),
        0,
      );
      await updateSyncStatus(this.db, fresh.id, {
        pgOutboxCursor: lastEvent.id,
        lastSyncedAt: new Date(),
        syncStatus: "idle",
        lastError: null,
        ...(documentCountDelta === 0 ? {} : { documentCountDelta }),
      });
    } finally {
      await close();
    }
  }

  private async initialSync(collection: ProjectCollection): Promise<void> {
    const { updateSyncStatus } = await import("../services/collections");
    await updateSyncStatus(this.db, collection.id, { syncStatus: "syncing" });

    try {
      await this.ensureCollectionIndex(collection);
      if (!collection.mongoDatabase || !collection.mongoCollection) {
        throw new Error(
          `Collection ${collection.id} missing mongo source fields`,
        );
      }

      const cursor = this.mongo
        .db(collection.mongoDatabase)
        .collection<Document>(collection.mongoCollection)
        .find({}, { batchSize: 1000 });
      const index = this.meili.index(collection.meiliIndexUid);
      let batch: Record<string, unknown>[] = [];
      let documentCount = 0;

      for await (const document of cursor) {
        batch.push(transformDocument(document, collection.fieldMapping));
        if (batch.length >= 1000) {
          await index.addDocuments(batch);
          documentCount += batch.length;
          batch = [];
          await this.delayIndexing();
        }
      }
      if (batch.length > 0) {
        await index.addDocuments(batch);
        documentCount += batch.length;
      }

      await updateSyncStatus(this.db, collection.id, {
        syncStatus: "idle",
        lastSyncedAt: new Date(),
        documentCount,
        lastError: null,
      });
    } catch (error) {
      await updateSyncStatus(this.db, collection.id, {
        syncStatus: "error",
        lastError: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async ensureCollectionIndex(
    collection: ProjectCollection,
  ): Promise<void> {
    try {
      await this.meili
        .createIndex(collection.meiliIndexUid, { primaryKey: "id" })
        .waitTask();
    } catch {
      // Existing indexes are expected when a worker resumes.
    }

    await this.meili.index(collection.meiliIndexUid).updateSettings({
      searchableAttributes: collection.fieldMapping.searchableAttributes ?? [
        "*",
      ],
      filterableAttributes: collection.fieldMapping.filterableAttributes ?? [],
      sortableAttributes: collection.fieldMapping.sortableAttributes ?? [],
    });
  }

  private async handleChangeEvent(
    collection: ProjectCollection,
    event: ChangeStreamDocument<Document>,
  ): Promise<void> {
    const buffer = this.buffers.get(collection.id);
    if (!buffer) {
      return;
    }

    switch (event.operationType) {
      case "insert":
      case "replace":
        buffer.operations.push({
          type: "upsert",
          id: String(event.documentKey._id),
          document: transformDocument(
            event.fullDocument,
            collection.fieldMapping,
          ),
        });
        break;
      case "update":
        if (event.fullDocument) {
          buffer.operations.push({
            type: "upsert",
            id: String(event.documentKey._id),
            document: transformDocument(
              event.fullDocument,
              collection.fieldMapping,
            ),
          });
        }
        break;
      case "delete":
        buffer.operations.push({
          type: "delete",
          id: String(event.documentKey._id),
        });
        break;
    }

    const { updateSyncStatus } = await import("../services/collections");
    await updateSyncStatus(this.db, collection.id, {
      resumeToken: resumeTokenRecord(event._id),
    });

    const totalBuffered = buffer.operations.length;
    if (totalBuffered >= this.batchSize) {
      await this.flushBuffer(collection.id, collection.meiliIndexUid);
    } else if (!buffer.timer) {
      buffer.timer = setTimeout(
        () => void this.flushBuffer(collection.id, collection.meiliIndexUid),
        this.batchDelayMs,
      );
    }
  }

  private async flushBuffer(
    collectionId: string,
    meiliIndexUid: string,
  ): Promise<void> {
    const buffer = this.buffers.get(collectionId);
    if (!buffer) {
      return;
    }
    if (buffer.timer) {
      clearTimeout(buffer.timer);
      buffer.timer = null;
    }

    const operations = buffer.operations.splice(0);
    if (operations.length === 0) {
      return;
    }

    try {
      const { upserts, deletes } = coalesceIndexOperations(operations);
      const index = this.meili.index(meiliIndexUid);
      if (upserts.length > 0) {
        await index.addDocuments(upserts);
      }
      if (deletes.length > 0) {
        await index.deleteDocuments(deletes);
      }

      const { updateSyncStatus } = await import("../services/collections");
      const documentCountDelta = operations.reduce(
        (delta, operation) => delta + (operation.type === "upsert" ? 1 : -1),
        0,
      );
      await updateSyncStatus(this.db, collectionId, {
        lastSyncedAt: new Date(),
        ...(documentCountDelta === 0 ? {} : { documentCountDelta }),
      });
      await this.delayIndexing();
    } catch (error) {
      console.error(
        `[SyncWorker] Failed to flush buffer for ${meiliIndexUid}:`,
        error,
      );
      buffer.operations.unshift(...operations);
    }
  }

  private async delayIndexing(): Promise<void> {
    if (this.indexingDelayMs > 0) {
      await Bun.sleep(this.indexingDelayMs);
    }
  }

  private async reconnect(collectionId: string): Promise<void> {
    if (this.stopping) {
      return;
    }

    try {
      const { getCollection } = await import("../services/collections");
      const collection = await getCollection(this.db, collectionId);
      if (collection.syncEnabled && collection.syncStatus !== "error") {
        await this.addCollection(collection);
      }
    } catch (error) {
      console.error(
        `[SyncWorker] Reconnect failed for ${collectionId}:`,
        error,
      );
    }
  }

  private async getCollectionById(
    collectionId: string,
  ): Promise<ProjectCollection | null> {
    try {
      const { getCollection } = await import("../services/collections");
      return await getCollection(this.db, collectionId);
    } catch {
      return null;
    }
  }

  isWatching(collectionId: string): boolean {
    return this.streams.has(collectionId) || this.pgPollers.has(collectionId);
  }

  get activeStreamCount(): number {
    return this.streams.size + this.pgPollers.size;
  }
}

export {
  dropTrigger as dropPgTrigger,
  ensureOutboxTable,
  triggerName as pgTriggerName,
};
