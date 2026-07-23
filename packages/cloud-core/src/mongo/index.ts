import { MongoClient } from "mongodb";

let client: MongoClient | null = null;

export function createMongoClient(uri: string): MongoClient {
  if (client) {
    return client;
  }

  client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
  });
  return client;
}

export function getMongoClient(): MongoClient {
  if (!client) {
    throw new Error(
      "MongoDB client not initialized. Call createMongoClient() first.",
    );
  }
  return client;
}

export async function closeMongoClient(): Promise<void> {
  if (!client) {
    return;
  }

  await client.close();
  client = null;
}
