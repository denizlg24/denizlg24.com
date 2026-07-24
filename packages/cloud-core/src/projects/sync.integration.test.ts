import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { Meilisearch } from "meilisearch";
import { MongoClient, ObjectId } from "mongodb";

import { createDb } from "../db";
import { projectCollections, projects, users } from "../db/schema";
import { createCollection } from "../services";
import { SyncWorker } from "../sync";

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

describeInfra("MongoDB to Meilisearch crash/resume synchronization", () => {
  const suffix = randomBytes(6).toString("hex");
  const username = `sync_it_${suffix}`;
  const projectSlug = `sync-it-${suffix}`;
  const mongoDatabase = `sync_it_${suffix}`;
  const mongoCollection = "documents";
  const meiliIndexUid = `${projectSlug}_${mongoCollection}`;
  const db = createDb(DATABASE_URL, { max: 2 });
  const mongo = new MongoClient(MONGO_URI);
  const meili = new Meilisearch({ host: MEILI_URL, apiKey: MEILI_KEY });
  let userId: string;
  let projectId: string;
  let collectionId: string;
  let worker: SyncWorker | null = null;

  beforeAll(async () => {
    await mongo.connect();
    const [user] = await db
      .insert(users)
      .values({ username, role: "superuser", totpEnabled: true })
      .returning({ id: users.id });
    if (!user) throw new Error("Failed to create sync test user");
    userId = user.id;
    const [project] = await db
      .insert(projects)
      .values({ name: username, slug: projectSlug, ownerId: userId })
      .returning({ id: projects.id });
    if (!project) throw new Error("Failed to create sync test project");
    projectId = project.id;
    await mongo
      .db(mongoDatabase)
      .collection(mongoCollection)
      .insertOne({ title: "initial" });
    const collection = await createCollection(db, {
      projectId,
      name: mongoCollection,
      sourceType: "mongodb",
      mongoDatabase,
      mongoCollection,
      meiliIndexUid,
    });
    collectionId = collection.id;
  });

  afterAll(async () => {
    await worker?.stop().catch(() => undefined);
    await meili
      .deleteIndex(meiliIndexUid)
      .waitTask()
      .catch(() => undefined);
    await mongo
      .db(mongoDatabase)
      .dropDatabase()
      .catch(() => undefined);
    if (projectId) {
      await db.delete(projects).where(eq(projects.id, projectId));
    }
    if (userId) {
      await db.delete(users).where(eq(users.id, userId));
    }
    await Promise.all([mongo.close(), db.$client.end()]);
  });

  it("indexes inserts/updates/deletes and resumes from the persisted token", async () => {
    worker = new SyncWorker({
      db,
      mongo,
      meili,
      batchDelayMs: 25,
      indexingDelayMs: 0,
    });
    const collection = await db.query.projectCollections.findFirst({
      where: eq(projectCollections.id, collectionId),
    });
    if (!collection) throw new Error("Sync test collection missing");
    await worker.addCollection(collection);

    const insertedId = new ObjectId();
    await mongo
      .db(mongoDatabase)
      .collection(mongoCollection)
      .insertOne({ _id: insertedId, title: "inserted" });
    await waitFor(async () => {
      const document = await meili
        .index(meiliIndexUid)
        .getDocument<{ title: string }>(insertedId.toHexString());
      return document.title === "inserted";
    });
    await waitFor(async () => {
      const persisted = await db.query.projectCollections.findFirst({
        where: eq(projectCollections.id, collectionId),
      });
      return persisted?.resumeToken !== null;
    });
    const persisted = await db.query.projectCollections.findFirst({
      where: eq(projectCollections.id, collectionId),
    });
    expect(persisted?.resumeToken).not.toBeNull();

    await worker.stop();
    worker = null;
    const duringRestartId = new ObjectId();
    await mongo
      .db(mongoDatabase)
      .collection(mongoCollection)
      .insertOne({ _id: duringRestartId, title: "during-restart" });

    worker = new SyncWorker({
      db,
      mongo,
      meili,
      batchDelayMs: 25,
      indexingDelayMs: 0,
    });
    await worker.start();
    await waitFor(async () => {
      const document = await meili
        .index(meiliIndexUid)
        .getDocument<{ title: string }>(duringRestartId.toHexString());
      return document.title === "during-restart";
    });

    await mongo
      .db(mongoDatabase)
      .collection(mongoCollection)
      .updateOne({ _id: duringRestartId }, { $set: { title: "updated" } });
    await mongo
      .db(mongoDatabase)
      .collection(mongoCollection)
      .deleteOne({ _id: insertedId });
    await waitFor(async () => {
      const document = await meili
        .index(meiliIndexUid)
        .getDocument<{ title: string }>(duringRestartId.toHexString());
      return document.title === "updated";
    });
    await waitFor(async () => {
      try {
        await meili.index(meiliIndexUid).getDocument(insertedId.toHexString());
        return false;
      } catch {
        return true;
      }
    });
  }, 60_000);
});
