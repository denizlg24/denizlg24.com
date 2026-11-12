import mongoose from "mongoose";
import {
  KNOWLEDGE_VECTOR_CONFIG,
  knowledgeIndexDefinition,
  knowledgeVectorIndexMatchesContract,
} from "@/lib/knowledge/vector-config";
import { connectDB } from "@/lib/mongodb";
import { KnowledgeChunk } from "@/models/KnowledgeChunk";
import { KnowledgeProjection } from "@/models/KnowledgeProjection";
import { KnowledgeSourceState } from "@/models/KnowledgeSourceState";
import { KnowledgeSourceVector } from "@/models/KnowledgeSourceVector";
import { StudyDocument } from "@/models/StudyDocument";
import { StudyDocumentExtraction } from "@/models/StudyDocumentExtraction";

/** Creates the regular and `$text` indexes and the Atlas vector index. Dry run unless --execute. */

async function main() {
  const execute = process.argv.includes("--execute");
  const definition = knowledgeIndexDefinition();
  if (!execute) {
    console.log(
      JSON.stringify({
        mode: "dry-run",
        searchIndex: { name: KNOWLEDGE_VECTOR_CONFIG.indexName, definition },
        chunkIndexes: KnowledgeChunk.schema.indexes(),
      }),
    );
    return;
  }

  await connectDB();
  for (const model of [
    KnowledgeChunk,
    KnowledgeSourceVector,
    KnowledgeSourceState,
    KnowledgeProjection,
    StudyDocument,
    StudyDocumentExtraction,
  ]) {
    await model.createIndexes();
    console.log(`Created indexes for ${model.modelName}`);
  }
  const existing = await KnowledgeChunk.collection
    .listSearchIndexes()
    .toArray();
  const match = existing.find(
    (index) => index.name === KNOWLEDGE_VECTOR_CONFIG.indexName,
  );
  if (!match) {
    await KnowledgeChunk.collection.createSearchIndex({
      name: KNOWLEDGE_VECTOR_CONFIG.indexName,
      type: "vectorSearch",
      definition,
    });
    console.log("Created the vector search index; it builds in the background");
  } else {
    console.log(
      knowledgeVectorIndexMatchesContract(match)
        ? "Vector search index is ready and matches the contract"
        : "Vector search index exists but is not ready or differs from the contract",
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
