import type { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

const MONGOD_VERSION = "8.2.1";

export const sprintMongoTestsEnabled = process.env.SPRINT_MONGO_TESTS === "1";

export async function startMongo(dbName: string): Promise<MongoMemoryServer> {
  const { MongoMemoryServer } = await import("mongodb-memory-server");
  const server = await MongoMemoryServer.create({
    binary: { version: MONGOD_VERSION },
  });
  const uri = server.getUri(dbName);
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri)) {
    throw new Error(`Refusing a non-local mongod: ${uri}`);
  }
  await mongoose.connect(uri);
  const cache = global.mongooseCache ?? { conn: null, promise: null };
  cache.conn = mongoose;
  cache.promise = Promise.resolve(mongoose);
  global.mongooseCache = cache;
  return server;
}

export async function stopMongo(server: MongoMemoryServer | undefined) {
  await mongoose.disconnect();
  await server?.stop();
}

export async function clearMongo() {
  const db = mongoose.connection.db;
  if (!db) throw new Error("no db");
  for (const collection of await db.collections()) {
    await collection.deleteMany({});
  }
}
