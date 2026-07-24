import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { Meilisearch } from "meilisearch";
import { MongoClient } from "mongodb";

import { createDb, createRawClient } from "../db";
import { projectCollections, projects, users } from "../db/schema";
import { createCollection } from "../services";
import { dropPgTrigger, SyncWorker } from "../sync";
import { createProjectPgClientFactory } from "./pg-client-factory";

const RUN_INFRA = process.env.RUN_CLOUD_INFRA_TESTS === "1";
const describeInfra = RUN_INFRA ? describe : describe.skip;
const DATABASE_URL =
  process.env.CLOUD_TEST_DATABASE_URL ??
  "postgresql://denizcloud:devpassword@localhost:5433/denizcloud";
const MONGO_URI =
  process.env.CLOUD_TEST_MONGODB_ADMIN_URI ??
  "mongodb://denizcloud:devpassword@localhost:27018/?authSource=admin&directConnection=true";
const MEILI_URL =
  process.env.CLOUD_TEST_MEILISEARCH_URL ?? "http://localhost:7700";
const MEILI_KEY =
  process.env.CLOUD_TEST_MEILI_MASTER_KEY ??
  "devmasterkey0000000000000000000000000000";

async function waitFor(
  assertion: () => Promise<boolean>,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await assertion().catch(() => false)) return;
    await Bun.sleep(100);
  }
  throw new Error("Timed out waiting for synchronized state");
}

describeInfra(
  "Postgres outbox to Meilisearch crash/resume synchronization",
  () => {
    const suffix = randomBytes(6).toString("hex");
    const username = `pg_sync_it_${suffix}`;
    const projectSlug = `pg-sync-it-${suffix}`;
    const tableName = `pg_sync_${suffix}`;
    const meiliIndexUid = `${projectSlug}_${tableName}`;
    const databaseName = decodeURIComponent(
      new URL(DATABASE_URL).pathname.slice(1),
    );
    const db = createDb(DATABASE_URL, { max: 2 });
    const sql = createRawClient(DATABASE_URL, { max: 1 });
    const mongo = new MongoClient(MONGO_URI);
    const meili = new Meilisearch({ host: MEILI_URL, apiKey: MEILI_KEY });
    const pgClientFactory = createProjectPgClientFactory(DATABASE_URL);
    let userId: string;
    let projectId: string;
    let collectionId: string;
    let worker: SyncWorker | null = null;

    beforeAll(async () => {
      await mongo.connect();
      await sql.unsafe(
        `create table "${tableName}" (id text primary key, title text not null)`,
      );
      await sql.unsafe(
        `insert into "${tableName}" (id, title) values ('initial', 'initial')`,
      );
      const [user] = await db
        .insert(users)
        .values({ username, role: "superuser", totpEnabled: true })
        .returning({ id: users.id });
      if (!user) throw new Error("Failed to create PG sync test user");
      userId = user.id;
      const [project] = await db
        .insert(projects)
        .values({ name: username, slug: projectSlug, ownerId: userId })
        .returning({ id: projects.id });
      if (!project) throw new Error("Failed to create PG sync test project");
      projectId = project.id;
      const collection = await createCollection(db, {
        projectId,
        name: tableName,
        sourceType: "postgres",
        pgDatabase: databaseName,
        pgSchema: "public",
        pgTable: tableName,
        pgIdColumn: "id",
        meiliIndexUid,
      });
      collectionId = collection.id;
    });

    afterAll(async () => {
      await worker?.stop().catch(() => undefined);
      if (collectionId) {
        const collection = await db.query.projectCollections.findFirst({
          where: eq(projectCollections.id, collectionId),
        });
        if (collection) {
          const client = await pgClientFactory.forCollection(collection);
          try {
            await dropPgTrigger(client.sql, "public", tableName).catch(
              () => undefined,
            );
          } finally {
            await client.close();
          }
        }
      }
      await sql
        .unsafe(`drop table if exists "${tableName}"`)
        .catch(() => undefined);
      await meili
        .deleteIndex(meiliIndexUid)
        .waitTask()
        .catch(() => undefined);
      if (projectId) {
        await db.delete(projects).where(eq(projects.id, projectId));
      }
      if (userId) {
        await db.delete(users).where(eq(users.id, userId));
      }
      await Promise.all([mongo.close(), sql.end(), db.$client.end()]);
    });

    it("commits Meili tasks before advancing and resumes the outbox cursor", async () => {
      worker = createWorker(db, mongo, meili, pgClientFactory);
      const collection = await db.query.projectCollections.findFirst({
        where: eq(projectCollections.id, collectionId),
      });
      if (!collection) throw new Error("PG sync test collection missing");
      await worker.addCollection(collection);
      await sql.unsafe(
        `insert into "${tableName}" (id, title) values ('before-restart', 'before')`,
      );
      await waitFor(() =>
        hasTitle(meili, meiliIndexUid, "before-restart", "before"),
      );
      await waitFor(async () => {
        const state = await db.query.projectCollections.findFirst({
          where: eq(projectCollections.id, collectionId),
        });
        return (state?.pgOutboxCursor ?? 0) > 0;
      });

      await worker.stop();
      worker = null;
      await sql.unsafe(
        `insert into "${tableName}" (id, title) values ('during-restart', 'during')`,
      );
      worker = createWorker(db, mongo, meili, pgClientFactory);
      await worker.start();
      await waitFor(() =>
        hasTitle(meili, meiliIndexUid, "during-restart", "during"),
      );

      await sql.unsafe(
        `update "${tableName}" set title = 'updated' where id = 'during-restart'`,
      );
      await sql.unsafe(
        `delete from "${tableName}" where id = 'before-restart'`,
      );
      await waitFor(() =>
        hasTitle(meili, meiliIndexUid, "during-restart", "updated"),
      );
      await waitFor(() => isMissing(meili, meiliIndexUid, "before-restart"));
      const finalState = await db.query.projectCollections.findFirst({
        where: eq(projectCollections.id, collectionId),
      });
      expect(finalState?.pgOutboxCursor).toBeGreaterThan(0);
    }, 60_000);
  },
);

function createWorker(
  db: ReturnType<typeof createDb>,
  mongo: MongoClient,
  meili: Meilisearch,
  pgClientFactory: ReturnType<typeof createProjectPgClientFactory>,
): SyncWorker {
  return new SyncWorker({
    db,
    mongo,
    meili,
    pgClientFactory,
    indexingDelayMs: 0,
    pgPollIntervalMs: 25,
  });
}

async function hasTitle(
  meili: Meilisearch,
  indexUid: string,
  id: string,
  title: string,
): Promise<boolean> {
  const document = await meili
    .index(indexUid)
    .getDocument<{ title: string }>(id);
  return document.title === title;
}

async function isMissing(
  meili: Meilisearch,
  indexUid: string,
  id: string,
): Promise<boolean> {
  try {
    await meili.index(indexUid).getDocument(id);
    return false;
  } catch {
    return true;
  }
}
