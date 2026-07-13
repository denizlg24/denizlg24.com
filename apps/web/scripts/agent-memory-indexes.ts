import type { Model } from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { AgentAuditEvent } from "@/models/AgentAuditEvent";
import { AgentEvidenceEvent } from "@/models/AgentEvidenceEvent";
import { AgentFeedbackEvent } from "@/models/AgentFeedbackEvent";
import { AgentGoal } from "@/models/AgentGoal";
import { AgentInsight } from "@/models/AgentInsight";
import { AgentMemory } from "@/models/AgentMemory";
import { AgentMemoryCandidate } from "@/models/AgentMemoryCandidate";
import { AgentMemoryEmbedding } from "@/models/AgentMemoryEmbedding";
import { AgentMemoryJob } from "@/models/AgentMemoryJob";
import { AgentMemoryRevision } from "@/models/AgentMemoryRevision";
import { AgentMemoryRun } from "@/models/AgentMemoryRun";
import { AgentMemorySettings } from "@/models/AgentMemorySettings";
import { AgentProcedure } from "@/models/AgentProcedure";
import { AgentRetrievalTrace } from "@/models/AgentRetrievalTrace";
import { AgentUserModel } from "@/models/AgentUserModel";
import { AgentUserModelRevision } from "@/models/AgentUserModelRevision";

const models: Model<unknown>[] = [
  AgentAuditEvent,
  AgentEvidenceEvent,
  AgentFeedbackEvent,
  AgentGoal,
  AgentInsight,
  AgentMemory,
  AgentMemoryCandidate,
  AgentMemoryEmbedding,
  AgentMemoryJob,
  AgentMemoryRevision,
  AgentMemoryRun,
  AgentMemorySettings,
  AgentProcedure,
  AgentRetrievalTrace,
  AgentUserModel,
  AgentUserModelRevision,
] as Model<unknown>[];

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  if (dryRun) {
    for (const model of models) {
      console.log(
        JSON.stringify({
          model: model.modelName,
          indexes: model.schema.indexes(),
        }),
      );
    }
    return;
  }

  await connectDB();
  for (const model of models) {
    await model.createIndexes();
    console.log(`Created indexes for ${model.modelName}`);
  }
}

await main();
