/**
 * Re-evaluate pending agent-memory candidates against the current promotion
 * policy (settings.promotion, default single-user) and auto-accept the ones
 * that now pass. Low-confidence email-only candidates and hard safety
 * failures (secrets, permission-like text) stay pending for manual review.
 *
 * Usage:
 *   bun --env-file=../../.env scripts/agent-memory-auto-accept.ts [--dry-run] [--limit=N]
 */
import mongoose from "mongoose";
import {
  evaluateCandidatePromotion,
  tryAutomaticallyPromoteMemoryCandidate,
} from "@/lib/agent-memory/governance";
import { getAgentMemorySettings } from "@/lib/agent-memory/settings";
import { connectDB } from "@/lib/mongodb";
import { AgentMemoryCandidate } from "@/models/AgentMemoryCandidate";

const dryRun = process.argv.includes("--dry-run");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : Infinity;
if (limitArg && (Number.isNaN(limit) || limit < 0)) {
  throw new Error(`Invalid --limit value: ${limitArg}`);
}

await connectDB();
const settings = await getAgentMemorySettings();
console.log(
  `promotion mode: ${settings.promotion.mode} (email review below ${settings.promotion.emailReviewMaxConfidence})${dryRun ? " [dry-run]" : ""}`,
);

const pending = await AgentMemoryCandidate.find({ status: "pending" })
  .sort({ createdAt: 1 })
  .select("_id")
  .lean();
console.log(`pending candidates: ${pending.length}`);

let accepted = 0;
let kept = 0;
const keptReasons = new Map<string, number>();
let processed = 0;

for (const candidate of pending) {
  if (processed >= limit) break;
  processed += 1;
  const candidateId = candidate._id.toString();
  try {
    const decision = dryRun
      ? await evaluateCandidatePromotion(candidateId)
      : await tryAutomaticallyPromoteMemoryCandidate({
          candidateId,
          reason: "Backlog auto-accept under single-user promotion policy",
        }).then((result) => ({
          allowed: result.promoted,
          reason: result.reason,
        }));
    if (decision.allowed) accepted += 1;
    else {
      kept += 1;
      keptReasons.set(
        decision.reason,
        (keptReasons.get(decision.reason) ?? 0) + 1,
      );
    }
  } catch (error) {
    kept += 1;
    const reason = error instanceof Error ? error.message : "Unknown error";
    keptReasons.set(reason, (keptReasons.get(reason) ?? 0) + 1);
  }
  if (processed % 100 === 0) {
    console.log(`… ${processed}/${pending.length} processed`);
  }
}

console.log(
  `${dryRun ? "would accept" : "accepted"}: ${accepted} · kept for review: ${kept}`,
);
for (const [reason, count] of [...keptReasons.entries()].sort(
  (a, b) => b[1] - a[1],
)) {
  console.log(`  kept ${count}× — ${reason}`);
}
await mongoose.disconnect();
