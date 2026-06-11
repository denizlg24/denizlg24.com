import mongoose from "mongoose";

declare global {
  var resourceMongooseCache:
    | {
        conn: mongoose.Connection | null;
        promise: Promise<mongoose.Connection> | null;
      }
    | undefined;
}

const MONGO_RESOURCE_URI = process.env.MONGO_RESOURCE_URI;

if (!MONGO_RESOURCE_URI) {
  throw new Error(
    "Please define the MONGO_RESOURCE_URI environment variable",
  );
}

let cached = global.resourceMongooseCache;

if (!cached) {
  cached = global.resourceMongooseCache = { conn: null, promise: null };
}

export async function connectResourceDB(): Promise<mongoose.Connection> {
  if (cached?.conn) {
    return cached.conn;
  }

  if (cached && !cached.promise) {
    const conn = mongoose.createConnection(MONGO_RESOURCE_URI!);
    cached.promise = conn.asPromise();
  }

  if (cached?.promise) {
    cached.conn = await cached.promise;
    return cached.conn;
  }

  throw new Error("Resource DB cache initialization failed");
}
