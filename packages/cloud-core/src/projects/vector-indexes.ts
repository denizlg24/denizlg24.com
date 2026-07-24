import type {
  CreateProjectVectorIndexInput,
  ProjectVectorIndex,
  ProjectVectorSearchOverview,
} from "@repo/schemas/cloud";
import { and, eq } from "drizzle-orm";
import type { Document, MongoClient } from "mongodb";

import type { Database } from "../db";
import { projectDatabases } from "../db/schema";
import { ConflictError, NotFoundError } from "../errors";

export interface MongotHealth {
  status: "ready" | "unavailable";
  message?: string;
}

function vectorFieldFrom(index: Document): Document | undefined {
  const definition = index.latestDefinition ?? index.definition;
  if (!definition || !Array.isArray(definition.fields)) return undefined;
  return definition.fields.find((field: Document) => field?.type === "vector");
}

export function normalizeVectorIndex(
  collection: string,
  index: Document,
): ProjectVectorIndex | null {
  const field = vectorFieldFrom(index);
  if (!field) return null;
  const definition = index.latestDefinition ?? index.definition;
  const filterPaths = Array.isArray(definition?.fields)
    ? definition.fields
        .filter(
          (item: Document) =>
            item?.type === "filter" && typeof item.path === "string",
        )
        .map((item: Document) => String(item.path))
    : [];
  const similarity =
    field.similarity === "euclidean" || field.similarity === "dotProduct"
      ? field.similarity
      : "cosine";
  const quantization =
    field.quantization === "scalar" || field.quantization === "binary"
      ? field.quantization
      : "none";
  return {
    collection,
    name: String(index.name),
    status: typeof index.status === "string" ? index.status : "UNKNOWN",
    queryable: index.queryable === true,
    path: String(field.path),
    numDimensions: Number(field.numDimensions),
    similarity,
    quantization,
    filterPaths,
  };
}

export async function getMongotHealth(baseUrl: string): Promise<MongotHealth> {
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/ready`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok
      ? { status: "ready" }
      : {
          status: "unavailable",
          message: `mongot returned HTTP ${response.status}`,
        };
  } catch {
    return { status: "unavailable", message: "mongot is not reachable" };
  }
}

async function projectMongoDatabase(
  db: Database,
  projectId: string,
): Promise<string> {
  const record = await db.query.projectDatabases.findFirst({
    columns: { dbName: true },
    where: and(
      eq(projectDatabases.projectId, projectId),
      eq(projectDatabases.type, "mongodb"),
    ),
  });
  if (!record) {
    throw new NotFoundError(
      "Project has no MongoDB database",
      "MONGODB_NOT_PROVISIONED",
    );
  }
  return record.dbName;
}

async function projectCollections(
  mongo: MongoClient,
  dbName: string,
): Promise<string[]> {
  return (
    await mongo.db(dbName).listCollections({}, { nameOnly: true }).toArray()
  )
    .map((collection) => collection.name)
    .filter((name) => !name.startsWith("system."));
}

async function listVectorIndexes(
  mongo: MongoClient,
  dbName: string,
  collections: string[],
): Promise<ProjectVectorIndex[]> {
  const indexes = await Promise.all(
    collections.map(async (collection) => {
      const raw = await mongo
        .db(dbName)
        .collection(collection)
        .listSearchIndexes()
        .toArray();
      return raw
        .map((index) => normalizeVectorIndex(collection, index))
        .filter((index): index is ProjectVectorIndex => index !== null);
    }),
  );
  return indexes.flat();
}

export async function getProjectVectorSearchOverview(
  db: Database,
  mongo: MongoClient,
  projectId: string,
  mongotHealthUrl: string,
  maxIndexes: number,
): Promise<ProjectVectorSearchOverview> {
  const dbName = await projectMongoDatabase(db, projectId);
  const collections = await projectCollections(mongo, dbName);
  const mongot = await getMongotHealth(mongotHealthUrl);
  let indexes: ProjectVectorIndex[] = [];
  if (mongot.status === "ready") {
    try {
      indexes = await listVectorIndexes(mongo, dbName, collections);
    } catch {
      mongot.status = "unavailable";
      mongot.message = "Vector index management is temporarily unavailable";
    }
  }
  return { database: dbName, collections, indexes, mongot, maxIndexes };
}

export async function createProjectVectorIndex(
  db: Database,
  mongo: MongoClient,
  projectId: string,
  input: CreateProjectVectorIndexInput,
  maxIndexes: number,
): Promise<{ collection: string; name: string; status: "BUILDING" }> {
  const dbName = await projectMongoDatabase(db, projectId);
  const mongoDb = mongo.db(dbName);
  const exists = await mongoDb
    .listCollections({ name: input.collection }, { nameOnly: true })
    .hasNext();
  if (!exists) {
    throw new NotFoundError(
      "Collection does not exist",
      "COLLECTION_NOT_FOUND",
    );
  }
  const collections = await projectCollections(mongo, dbName);
  const indexes = await listVectorIndexes(mongo, dbName, collections);
  if (indexes.length >= maxIndexes) {
    throw new ConflictError(
      `Projects may have at most ${maxIndexes} vector indexes`,
      "INDEX_QUOTA_REACHED",
    );
  }
  if (
    indexes.some(
      (index) =>
        index.collection === input.collection && index.name === input.name,
    )
  ) {
    throw new ConflictError(
      "A vector index with this name already exists",
      "INDEX_EXISTS",
    );
  }
  const fields: Document[] = [
    {
      type: "vector",
      path: input.path,
      numDimensions: input.numDimensions,
      similarity: input.similarity,
      ...(input.quantization === "none"
        ? {}
        : { quantization: input.quantization }),
    },
    ...input.filterPaths.map((path) => ({ type: "filter", path })),
  ];
  const name = await mongoDb.collection(input.collection).createSearchIndex({
    name: input.name,
    type: "vectorSearch",
    definition: { fields },
  });
  return { collection: input.collection, name, status: "BUILDING" };
}

export async function deleteProjectVectorIndex(
  db: Database,
  mongo: MongoClient,
  projectId: string,
  collection: string,
  indexName: string,
): Promise<{ collection: string; name: string; dropped: true }> {
  const dbName = await projectMongoDatabase(db, projectId);
  await mongo.db(dbName).collection(collection).dropSearchIndex(indexName);
  return { collection, name: indexName, dropped: true };
}
