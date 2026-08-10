/**
 * Redacts the agent-memory trail left by email triage rows that the current
 * eligibility rule would refuse.
 *
 * Triage evidence used to be observed for every classified message, so memory
 * filled with an external sender's assertions and a classifier's guesses about
 * an inbox that was already searchable. `domainRecordIsMemoryEligible` now
 * admits a row only once the owner has accepted one of its suggestions. This
 * clears the backlog the old rule produced; anything tied to an acceptance is
 * left exactly as it is.
 *
 * Each rejected source goes through `redactAgentMemorySource`, the same cascade
 * the delete-my-data path uses — evidence redacted, candidates, memories,
 * revisions, embeddings, traces, goals, procedures and insights removed, pending
 * jobs cancelled, audit rows stamped. Nothing is deleted by hand here.
 *
 *   bun --env-file=../../.env scripts/purge-ineligible-triage-memories.ts
 *     --execute      redact instead of reporting
 *     --verbose      print every rejected row, not just the totals
 *     --limit=N      stop after N distinct triage sources
 */
import mongoose from "mongoose";
import { domainRecordIsMemoryEligible } from "@/lib/agent-memory/domain-evidence";
import { redactAgentMemorySource } from "@/lib/agent-memory/source-deletion";
import { connectDB } from "@/lib/mongodb";
import { AgentEvidenceEvent } from "@/models/AgentEvidenceEvent";
import { EmailTriageModel } from "@/models/EmailTriage";

const execute = process.argv.includes("--execute");
const verbose = process.argv.includes("--verbose");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg
  ? Number(limitArg.split("=")[1])
  : Number.POSITIVE_INFINITY;
if (limitArg && (!Number.isFinite(limit) || limit < 1)) {
  throw new Error(`Invalid --limit value: ${limitArg}`);
}

await connectDB();

/**
 * Sourced from the evidence ledger rather than from triage rows, so a source
 * whose triage document has since been deleted is still cleaned up. Those are
 * the worst offenders: nothing else in the system can reach them any more.
 */
const entityIds: string[] = await AgentEvidenceEvent.distinct(
  "sourceRef.entityId",
  {
    sourceType: "email-triage",
    redactedAt: { $exists: false },
  },
);

if (entityIds.length === 0) {
  console.log("No unredacted email-triage evidence found.");
  await mongoose.disconnect();
  process.exit(0);
}

const totals = {
  scanned: 0,
  keptEligible: 0,
  keptMissingRow: 0,
  rejected: 0,
  evidenceRedacted: 0,
  candidatesDeleted: 0,
  memoriesDeleted: 0,
  tracesDeleted: 0,
  jobsCancelled: 0,
};

for (const entityId of entityIds) {
  if (totals.rejected >= limit) break;
  totals.scanned++;

  // The triage row is the authority on eligibility. A stored snapshot would
  // answer with whatever was true when the evidence was written, which for the
  // rows this script exists for is exactly the wrong answer.
  //
  // `buildDomainEvidence` keys triage evidence on the *email* id, not on the
  // triage row's own `_id` — looking it up by primary key finds nothing and
  // would condemn every source in the ledger.
  const triage = mongoose.isValidObjectId(entityId)
    ? await EmailTriageModel.findOne({ emailId: entityId }).lean()
    : null;

  if (triage && domainRecordIsMemoryEligible("email-triage", triage)) {
    totals.keptEligible++;
    continue;
  }

  // A row that no longer exists cannot show an acceptance, and its memories are
  // unreachable from every other surface. Treated as rejected, not kept.
  if (!triage) totals.keptMissingRow++;
  totals.rejected++;

  if (verbose) {
    console.log(
      `${execute ? "redact" : "would redact"} ${entityId}` +
        (triage ? "" : " (triage row gone)"),
    );
  }
  if (!execute) continue;

  const result = await redactAgentMemorySource({
    entityType: "email",
    entityId,
  });
  totals.evidenceRedacted += result.evidenceRedacted;
  totals.candidatesDeleted += result.candidatesDeleted;
  totals.memoriesDeleted += result.memoriesDeleted;
  totals.tracesDeleted += result.tracesDeleted;
  totals.jobsCancelled += result.jobsCancelled;
}

console.log(
  JSON.stringify(
    {
      mode: execute ? "execute" : "dry-run",
      sourcesScanned: totals.scanned,
      keptWithAcceptedSuggestion: totals.keptEligible,
      rejected: totals.rejected,
      rejectedWhoseTriageRowIsGone: totals.keptMissingRow,
      ...(execute
        ? {
            evidenceRedacted: totals.evidenceRedacted,
            candidatesDeleted: totals.candidatesDeleted,
            memoriesDeleted: totals.memoriesDeleted,
            tracesDeleted: totals.tracesDeleted,
            jobsCancelled: totals.jobsCancelled,
          }
        : {}),
    },
    null,
    2,
  ),
);

if (!execute) {
  console.log("\nDry run. Re-run with --execute to apply.");
}

await mongoose.disconnect();
