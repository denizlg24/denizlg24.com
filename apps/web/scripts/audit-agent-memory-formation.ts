/**
 * Read-only audit of what the formation pass is actually producing.
 *
 * Written to answer a specific question: five near-identical finance snapshots
 * turned up as contradiction chains, and the contradiction links were only the
 * symptom. This reports which evidence sources mint memories, which of those
 * memories restate a moving value rather than a durable fact, and which ones
 * cluster into near-duplicate runs.
 *
 *   bun --env-file=../../.env scripts/audit-agent-memory-formation.ts [--samples=N]
 */
import mongoose from "mongoose";
import { keywordTerms } from "@/lib/agent-memory/lexical-overlap";
import { connectDB } from "@/lib/mongodb";
import { AgentEvidenceEvent } from "@/models/AgentEvidenceEvent";
import { AgentMemory, type IAgentMemory } from "@/models/AgentMemory";

const samplesArg = process.argv.find((arg) => arg.startsWith("--samples="));
const samples = samplesArg ? Number(samplesArg.split("=")[1]) : 3;
// `Number("abc")` is NaN and `slice(0, NaN)` is empty, so a typo would print no
// samples at all and read as a clean audit.
if (samplesArg && (!Number.isFinite(samples) || samples < 0)) {
  throw new Error(`Invalid --samples value: ${samplesArg}`);
}

function truncate(value: string, max = 110): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

function pct(part: number, whole: number): string {
  return whole === 0 ? "0%" : `${Math.round((part / whole) * 100)}%`;
}

await connectDB();

const memories = await AgentMemory.find({ status: "active" }).sort({
  createdAt: 1,
});
console.log(`active memories: ${memories.length}\n`);

// ── Which evidence source each memory came from ─────────────────────────────
const evidenceIds = [
  ...new Set(memories.flatMap((memory) => memory.evidenceIds)),
];
const evidence = await AgentEvidenceEvent.find({
  eventId: { $in: evidenceIds },
})
  .select("eventId sourceType sourceRef actor occurredAt")
  .lean<
    {
      eventId: string;
      sourceType: string;
      sourceRef: { entityType: string; entityId: string };
      actor: string;
      occurredAt: Date;
    }[]
  >();
const evidenceByEventId = new Map(evidence.map((item) => [item.eventId, item]));

function sourcesOf(memory: IAgentMemory): string[] {
  return [
    ...new Set(
      memory.evidenceIds
        .map((eventId) => evidenceByEventId.get(eventId)?.sourceType)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}

const bySource = new Map<string, IAgentMemory[]>();
for (const memory of memories) {
  for (const source of sourcesOf(memory)) {
    const group = bySource.get(source);
    if (group) group.push(memory);
    else bySource.set(source, [memory]);
  }
}

/**
 * A statement that pins itself to a moment and carries a number is reporting a
 * reading, not a durable fact. These are the ones that chain: each new one
 * disagrees with the last and neither is wrong.
 */
const SNAPSHOT_PATTERNS = [
  /\bas of\b/i,
  /\bcurrently\b/i,
  /\bat present\b/i,
  /\bas at\b/i,
  /\btotal(?:ling|s|ed)?\b.*\d/i,
  /\bbalance\b.*\d/i,
];
function looksLikeSnapshot(memory: IAgentMemory): boolean {
  const hasNumber = /\d/.test(memory.statement);
  return hasNumber && SNAPSHOT_PATTERNS.some((rx) => rx.test(memory.statement));
}

console.log("by evidence source");
const sourceRows = [...bySource.entries()]
  .map(([source, items]) => ({
    source,
    total: items.length,
    snapshots: items.filter(looksLikeSnapshot).length,
    inferred: items.filter((item) => item.explicitness !== "explicit").length,
  }))
  .sort((a, b) => b.total - a.total);
for (const row of sourceRows) {
  console.log(
    `  ${row.source.padEnd(16)} ${String(row.total).padStart(4)}  snapshot-shaped ${String(
      row.snapshots,
    ).padStart(
      4,
    )} (${pct(row.snapshots, row.total)})  inferred ${row.inferred}`,
  );
}

// ── Which sourceRef keeps minting memories ─────────────────────────────────
const byRef = new Map<string, IAgentMemory[]>();
for (const memory of memories) {
  for (const eventId of memory.evidenceIds) {
    const item = evidenceByEventId.get(eventId);
    if (!item?.sourceRef) continue;
    const key = `${item.sourceType}:${item.sourceRef.entityType}:${item.sourceRef.entityId}`;
    const group = byRef.get(key);
    if (group) group.push(memory);
    else byRef.set(key, [memory]);
  }
}
const repeatRefs = [...byRef.entries()]
  .filter(([, items]) => items.length > 1)
  .sort((a, b) => b[1].length - a[1].length)
  .slice(0, 12);
if (repeatRefs.length > 0) {
  console.log("\nsource records that produced more than one memory");
  for (const [key, items] of repeatRefs) {
    console.log(`  ${String(items.length).padStart(3)}×  ${truncate(key, 90)}`);
  }
}

// ── Near-duplicate runs, by lexical overlap ────────────────────────────────
/**
 * Deliberately lexical rather than vector-based: the point is to find statements
 * that restate each other in almost the same words, which is what a re-observed
 * reading looks like. Vector neighbours would also pull in merely related facts.
 */
const OVERLAP_THRESHOLD = 0.72;
const termsById = new Map(
  memories.map((memory) => [
    memory._id.toString(),
    keywordTerms(memory.statement),
  ]),
);
function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const term of a) if (b.has(term)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

const seen = new Set<string>();
const clusters: IAgentMemory[][] = [];
for (const memory of memories) {
  const id = memory._id.toString();
  if (seen.has(id)) continue;
  const terms = termsById.get(id);
  if (!terms) continue;
  const cluster = [memory];
  seen.add(id);
  for (const other of memories) {
    const otherId = other._id.toString();
    if (seen.has(otherId)) continue;
    const otherTerms = termsById.get(otherId);
    if (!otherTerms) continue;
    if (overlap(terms, otherTerms) >= OVERLAP_THRESHOLD) {
      cluster.push(other);
      seen.add(otherId);
    }
  }
  if (cluster.length > 1) clusters.push(cluster);
}

clusters.sort((a, b) => b.length - a.length);
const clustered = clusters.reduce((sum, cluster) => sum + cluster.length, 0);
console.log(
  `\nnear-duplicate clusters: ${clusters.length} covering ${clustered} memories (${pct(
    clustered,
    memories.length,
  )} of the corpus)`,
);
for (const cluster of clusters.slice(0, samples)) {
  const sources = [...new Set(cluster.flatMap(sourcesOf))].join(", ");
  console.log(`\n  ${cluster.length}× via ${sources || "unknown"}`);
  for (const memory of cluster.slice(0, 4)) {
    console.log(
      `    ${new Date(memory.createdAt).toISOString().slice(0, 16)}  ${truncate(memory.statement)}`,
    );
  }
  if (cluster.length > 4) console.log(`    … ${cluster.length - 4} more`);
}

const snapshots = memories.filter(looksLikeSnapshot);
console.log(
  `\nsnapshot-shaped overall: ${snapshots.length} of ${memories.length} (${pct(
    snapshots.length,
    memories.length,
  )})`,
);
const undatedSnapshots = snapshots.filter(
  (memory) => !memory.temporal?.validFrom,
);
console.log(
  `  without temporal.validFrom: ${undatedSnapshots.length} — these are the ones that will chain as contradictions`,
);
for (const memory of undatedSnapshots.slice(0, samples)) {
  console.log(`    ${truncate(memory.statement)}`);
}

await mongoose.disconnect();
