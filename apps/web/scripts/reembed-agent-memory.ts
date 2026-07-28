/**
 * Re-embeds the whole memory corpus into the multimodal vector space.
 *
 * Text and images only compare meaningfully when a single model embedded both,
 * so switching `AGENT_MEMORY_VECTOR_CONFIG.model` invalidates every existing
 * vector. Every `$vectorSearch` filters on `model`, so old vectors are never
 * matched rather than mixed in — which also means **retrieval returns nothing
 * until this has run**. Run it to completion before deploying a model change.
 *
 *   bun scripts/reembed-agent-memory.ts                  # dry run, no writes
 *   bun scripts/reembed-agent-memory.ts --verify         # coverage report only
 *   bun scripts/reembed-agent-memory.ts --execute        # write new vectors
 *   bun scripts/reembed-agent-memory.ts --execute --prune-stale
 */
import { loadAttachmentParts } from "@/lib/agent-memory/attachments";
import { cleanupAgentMemoryEmbeddings } from "@/lib/agent-memory/embedding";
import { stableContentHash } from "@/lib/agent-memory/evidence";
import { findDeniedContent } from "@/lib/agent-memory/security";
import {
  findSimilarMemories,
  SIMILARITY_TOP_K,
  upsertSimilarityLinks,
} from "@/lib/agent-memory/similarity";
import { AGENT_MEMORY_VECTOR_CONFIG } from "@/lib/agent-memory/vector-config";
import { embedMultimodal } from "@/lib/llm-service";
import { connectDB } from "@/lib/mongodb";
import { AgentEvidenceEvent } from "@/models/AgentEvidenceEvent";
import { AgentMemory } from "@/models/AgentMemory";
import { AgentMemoryEmbedding } from "@/models/AgentMemoryEmbedding";
import { AgentMemorySettings } from "@/models/AgentMemorySettings";
import { AgentMemorySimilarity } from "@/models/AgentMemorySimilarity";

const BATCH_SIZE = 50;

interface Summary {
  mode: "dry-run" | "verify" | "execute";
  model: string;
  activeMemories: number;
  alreadyEmbedded: number;
  embedded: number;
  withImage: number;
  skipped: number;
  failed: number;
  prunedStale: number;
  removedStaleRevisions: number;
  rebuiltSimilarityLinks: number;
  removedSimilarityLinks: number;
  settingsUpdated: boolean;
  estimatedCostUsd: number;
}

async function imageForMemory(
  evidenceIds: string[],
): Promise<string | undefined> {
  const source = await AgentEvidenceEvent.findOne({
    eventId: { $in: evidenceIds },
    sourceType: "attachment",
    redactedAt: { $exists: false },
    memoryEligible: true,
    "provenance.hasImage": true,
  })
    .select("provenance")
    .lean<{ provenance?: Record<string, unknown> }>();
  const url = source?.provenance?.attachmentUrl;
  if (typeof url !== "string") return undefined;
  try {
    const loaded = await loadAttachmentParts({
      type: "image",
      url,
      name: String(source?.provenance?.attachmentName ?? "attachment"),
    });
    return loaded.parts[0]?.image;
  } catch {
    return undefined;
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const execute = args.has("--execute");
  const verify = args.has("--verify");
  const pruneStale = args.has("--prune-stale");
  if (execute && args.has("--dry-run")) {
    throw new Error("Pass either --dry-run or --execute, not both");
  }

  await connectDB();
  const model = AGENT_MEMORY_VECTOR_CONFIG.model;
  const summary: Summary = {
    mode: verify ? "verify" : execute ? "execute" : "dry-run",
    model,
    activeMemories: 0,
    alreadyEmbedded: 0,
    embedded: 0,
    withImage: 0,
    skipped: 0,
    failed: 0,
    prunedStale: 0,
    removedStaleRevisions: 0,
    rebuiltSimilarityLinks: 0,
    removedSimilarityLinks: 0,
    settingsUpdated: false,
    estimatedCostUsd: 0,
  };

  const active = await AgentMemory.find({ status: "active" })
    .select(
      "statement evidenceIds currentRevisionId sensitivity memoryType temporal",
    )
    .lean();
  summary.activeMemories = active.length;

  const embeddedRevisions = new Set(
    (
      await AgentMemoryEmbedding.find({ model })
        .select("memoryRevisionId")
        .lean()
    ).map((row) => String(row.memoryRevisionId)),
  );
  summary.alreadyEmbedded = active.filter((memory) =>
    embeddedRevisions.has(String(memory.currentRevisionId)),
  ).length;

  if (verify) {
    console.log(JSON.stringify(summary));
    return;
  }

  const pending = active.filter(
    (memory) => !embeddedRevisions.has(String(memory.currentRevisionId)),
  );

  for (let start = 0; start < pending.length; start += BATCH_SIZE) {
    const batch = pending.slice(start, start + BATCH_SIZE);
    for (const memory of batch) {
      if (findDeniedContent(memory.statement).length > 0) {
        summary.skipped += 1;
        continue;
      }
      const image = await imageForMemory(
        (memory.evidenceIds ?? []).map(String),
      );
      if (image) summary.withImage += 1;

      if (!execute) {
        summary.embedded += 1;
        continue;
      }
      try {
        const result = await embedMultimodal({
          purpose: "agent-memory-embedding",
          source: "agent-memory-reembed-migration",
          model,
          dimensions: AGENT_MEMORY_VECTOR_CONFIG.dimensions,
          inputType: "search_document",
          inputs: [{ text: memory.statement, ...(image ? { image } : {}) }],
        });
        const vector = result.vectors[0];
        if (!vector) throw new Error("no vector returned");
        summary.estimatedCostUsd += result.usage.costUsd;
        await AgentMemoryEmbedding.updateOne(
          { memoryRevisionId: memory.currentRevisionId, model },
          {
            $set: {
              memoryId: memory._id,
              dimensions: result.dimensions,
              vector,
              contentHash: stableContentHash(memory.statement),
              sensitivity: memory.sensitivity,
              status: "active",
              memoryType: memory.memoryType,
              validUntil: memory.temporal?.validUntil
                ? new Date(memory.temporal.validUntil)
                : null,
            },
          },
          { upsert: true },
        );
        summary.embedded += 1;
        try {
          const neighbors = await findSimilarMemories(vector, {
            limit: SIMILARITY_TOP_K + 1,
          });
          summary.rebuiltSimilarityLinks += await upsertSimilarityLinks(
            memory._id,
            neighbors,
          );
        } catch (error) {
          // The vector is authoritative; link refresh is eventually repaired by
          // consolidation and should not prevent the settings cutover.
          console.error(
            `[reembed] similarity refresh for ${String(memory._id)} failed:`,
            error instanceof Error ? error.message : error,
          );
        }
      } catch (error) {
        summary.failed += 1;
        console.error(
          `[reembed] ${String(memory._id)} failed:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
    console.error(
      `[reembed] ${Math.min(start + BATCH_SIZE, pending.length)}/${pending.length}`,
    );
  }

  if (execute && pruneStale) {
    const result = await AgentMemoryEmbedding.deleteMany({
      model: { $ne: model },
    });
    summary.prunedStale = result.deletedCount;
    const links = await AgentMemorySimilarity.deleteMany({
      model: { $ne: model },
    });
    summary.removedSimilarityLinks = links.deletedCount;
  }

  // The embedding job refuses to run when persisted settings disagree with the
  // vector contract, so the flip only completes once settings match.
  if (execute && summary.failed === 0) {
    const cleanup = await cleanupAgentMemoryEmbeddings();
    summary.removedStaleRevisions = cleanup.removedEmbeddings;
    summary.removedSimilarityLinks += cleanup.removedLinks;
    const updated = await AgentMemorySettings.updateMany(
      {},
      {
        $set: {
          "retrieval.embeddingModel": model,
          "retrieval.embeddingDimensions":
            AGENT_MEMORY_VECTOR_CONFIG.dimensions,
          "retrieval.vectorIndex": AGENT_MEMORY_VECTOR_CONFIG.indexName,
        },
      },
    );
    summary.settingsUpdated = updated.modifiedCount > 0;
  }

  console.log(JSON.stringify(summary));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
