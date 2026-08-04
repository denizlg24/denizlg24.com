/**
 * Replays every stored contradiction link through the temporal classifier that
 * now runs at formation time, and resolves the ones that were only ever a value
 * moving forward.
 *
 * Links written before `classifyTemporalConflict` existed were flagged whenever
 * two statements disagreed, with no way to tell "this fact changed" from "one of
 * these is wrong". This clears the backlog those rules produced. Anything the
 * classifier still calls a contradiction is left exactly as it is.
 *
 *   bun --env-file=../../.env scripts/reclassify-agent-memory-contradictions.ts
 *     --execute      apply the resolutions instead of reporting them
 *     --verbose      print every pair, not just the resolvable ones
 *     --limit=N      stop after N directed links
 */
import mongoose from "mongoose";
import {
  removeContradictionLinks,
  supersedeMemory,
} from "@/lib/agent-memory/governance";
import {
  classifyTemporalConflict,
  type TemporalConflictClass,
  type TemporalConflictSide,
} from "@/lib/agent-memory/temporal-succession";
import { connectDB } from "@/lib/mongodb";
import { AgentEvidenceEvent } from "@/models/AgentEvidenceEvent";
import { AgentMemory, type IAgentMemory } from "@/models/AgentMemory";

const execute = process.argv.includes("--execute");
const verbose = process.argv.includes("--verbose");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : Infinity;
if (limitArg && (!Number.isFinite(limit) || limit < 1)) {
  throw new Error(`Invalid --limit value: ${limitArg}`);
}

const SCAN_LIMIT = 2_000;

function truncate(value: string, max = 96): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

function formatDate(value: Date | string | undefined | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toISOString().slice(0, 16);
}

await connectDB();

const owners = await AgentMemory.find({
  status: "active",
  "contradictionIds.0": { $exists: true },
})
  .sort({ updatedAt: -1, _id: 1 })
  .limit(SCAN_LIMIT);

if (owners.length === 0) {
  console.log("No active memory carries a contradiction link.");
  await mongoose.disconnect();
  process.exit(0);
}

const targetIds = [
  ...new Set(
    owners.flatMap((memory) =>
      memory.contradictionIds
        .map((id) => id.toString())
        .filter((id) => mongoose.isValidObjectId(id)),
    ),
  ),
];
// Only active-vs-active pairs are real. A link to a superseded or archived
// memory is already moot and the consolidation sweep prunes it.
const targets = await AgentMemory.find({
  _id: { $in: targetIds },
  status: "active",
});
const targetsById = new Map(
  targets.map((memory) => [memory._id.toString(), memory]),
);

/**
 * When each statement was actually observed. The memory row's own `updatedAt`
 * moves on every revision — including the ones this script is about to write —
 * so ordering reads from the evidence instead, which is what the statement was
 * derived from and never moves.
 */
const involved = [...owners, ...targets];
const evidenceIds = [
  ...new Set(involved.flatMap((memory) => memory.evidenceIds)),
];
const evidence = await AgentEvidenceEvent.find({
  eventId: { $in: evidenceIds },
})
  .select("eventId occurredAt")
  .lean<{ eventId: string; occurredAt: Date }[]>();
const occurredByEventId = new Map(
  evidence.map((item) => [item.eventId, item.occurredAt]),
);

function observedAt(memory: IAgentMemory): Date {
  const times = memory.evidenceIds
    .map((eventId) => occurredByEventId.get(eventId))
    .filter((value): value is Date => Boolean(value))
    .map((value) => new Date(value).getTime());
  return times.length > 0
    ? new Date(Math.max(...times))
    : new Date(memory.createdAt);
}

function sideOf(memory: IAgentMemory): TemporalConflictSide {
  return {
    temporal: memory.temporal,
    explicitness: memory.explicitness,
    observedAt: observedAt(memory),
  };
}

interface Decision {
  owner: IAgentMemory;
  target: IAgentMemory;
  classification: TemporalConflictClass;
}

const decisions: Decision[] = [];
for (const owner of owners) {
  for (const contradictionId of owner.contradictionIds) {
    if (decisions.length >= limit) break;
    const target = targetsById.get(contradictionId.toString());
    if (!target) continue;
    decisions.push({
      owner,
      target,
      classification: classifyTemporalConflict({
        candidate: sideOf(owner),
        prior: sideOf(target),
      }),
    });
  }
}

const byClass = (value: TemporalConflictClass) =>
  decisions.filter((decision) => decision.classification === value);
const successions = byClass("succession");
const stales = byClass("stale");
const contradictions = byClass("contradiction");

/**
 * Succession links chain. A run of daily snapshots produces links from every
 * newer statement to every older one, so the same memory shows up as the
 * survivor of one pair and the retiree of another. Resolving pair by pair would
 * supersede a memory and then point a later pair's survivor at it.
 *
 * So the links are collapsed into connected components first, and each
 * component keeps exactly one memory — the one nothing supersedes — with every
 * other member retired against it. Five daily snapshots become one survivor and
 * four supersessions rather than nine independent rewrites.
 */
const parent = new Map<string, string>();
function find(id: string): string {
  const seen = parent.get(id);
  if (seen === undefined || seen === id) return id;
  const root = find(seen);
  parent.set(id, root);
  return root;
}
function union(a: string, b: string) {
  if (!parent.has(a)) parent.set(a, a);
  if (!parent.has(b)) parent.set(b, b);
  const rootA = find(a);
  const rootB = find(b);
  if (rootA !== rootB) parent.set(rootA, rootB);
}

const memoryById = new Map<string, IAgentMemory>();
for (const decision of successions) {
  const ownerId = decision.owner._id.toString();
  const targetId = decision.target._id.toString();
  memoryById.set(ownerId, decision.owner);
  memoryById.set(targetId, decision.target);
  union(ownerId, targetId);
}

const components = new Map<string, string[]>();
for (const id of memoryById.keys()) {
  const root = find(id);
  components.set(root, [...(components.get(root) ?? []), id]);
}

interface Retirement {
  survivor: IAgentMemory;
  retired: IAgentMemory;
}
const retirements: Retirement[] = [];
for (const members of components.values()) {
  const ordered = members
    .map((id) => memoryById.get(id))
    .filter((memory): memory is IAgentMemory => Boolean(memory))
    .sort((a, b) => observedAt(b).getTime() - observedAt(a).getTime());
  const survivor = ordered[0];
  if (!survivor) continue;
  for (const retired of ordered.slice(1)) {
    retirements.push({ survivor, retired });
  }
}

/** Links inside a component whose own endpoints are both retired: moot once the
 *  component collapses, so they are dropped rather than acted on. */
const retiredIds = new Set(
  retirements.map((item) => item.retired._id.toString()),
);
const mootLinks = successions.filter((decision) =>
  retiredIds.has(decision.owner._id.toString()),
);

console.log(
  `${decisions.length} active contradiction link(s) across ${owners.length} memories${
    execute ? "" : " [dry run — pass --execute to apply]"
  }`,
);
console.log(
  `  succession ${successions.length} · stale ${stales.length} · contradiction ${contradictions.length}`,
);
console.log(
  `  collapsing into ${components.size} chain(s): ${retirements.length} supersession(s), ${mootLinks.length} link(s) moot`,
);

function line(label: string, memory: IAgentMemory) {
  console.log(
    `    ${label.padEnd(9)} ${truncate(memory.statement)}\n              observed ${formatDate(
      observedAt(memory),
    )} · from ${formatDate(memory.temporal?.validFrom)} · ${memory.explicitness}`,
  );
}

for (const [root, members] of components) {
  const survivor = memoryById.get(
    retirements
      .find((item) => find(item.retired._id.toString()) === root)
      ?.survivor._id.toString() ?? root,
  );
  if (!survivor || members.length < 2) continue;
  console.log(`\n  chain of ${members.length}`);
  line("keep", survivor);
  for (const item of retirements.filter(
    (entry) => find(entry.retired._id.toString()) === root,
  )) {
    line("retire", item.retired);
  }
}

for (const decision of stales) {
  console.log(`\n  stale link  ${decision.owner._id.toString()}`);
  line("keep", decision.owner);
  line("unlink", decision.target);
}
if (verbose) {
  for (const decision of contradictions) {
    console.log(`\n  unchanged   ${decision.owner._id.toString()}`);
    line("keep", decision.owner);
    line("keep", decision.target);
  }
}

if (!execute) {
  console.log(
    `\nWould supersede ${retirements.length} memory(ies) and drop ${
      stales.length + mootLinks.length
    } link(s). Nothing was written.`,
  );
  await mongoose.disconnect();
  process.exit(0);
}

let superseded = 0;
let dropped = 0;
let failed = 0;

for (const item of retirements) {
  try {
    await supersedeMemory({
      supersededMemoryId: item.retired._id.toString(),
      survivingMemoryId: item.survivor._id.toString(),
      reason:
        "Backlog reclassification: the disagreement is a value moving forward in time",
      actor: "policy",
    });
    superseded += 1;
  } catch (error) {
    failed += 1;
    console.error(
      `  failed ${item.survivor._id.toString()} → ${item.retired._id.toString()}:`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

// Links held by a memory that has itself just been retired. Consolidation would
// prune them on its next pass; clearing them here leaves the data clean now.
for (const decision of mootLinks) {
  try {
    await removeContradictionLinks({
      memoryId: decision.owner._id.toString(),
      targetMemoryIds: [decision.target._id.toString()],
      reason: "Backlog reclassification: superseded by a later statement",
      actor: "policy",
    });
    dropped += 1;
  } catch {
    // The supersession revision may already have carried the link away.
  }
}

// A stale link is one whose target describes a *later* state than the memory
// holding it, so superseding on it would walk the memory backwards. The link is
// dropped and the pair left for the owner: the reverse direction, if it is real,
// is its own link and gets classified on its own terms.
for (const decision of stales) {
  try {
    await removeContradictionLinks({
      memoryId: decision.owner._id.toString(),
      targetMemoryIds: [decision.target._id.toString()],
      reason:
        "Backlog reclassification: the linked memory describes a later state, not a conflicting one",
      actor: "policy",
    });
    dropped += 1;
  } catch (error) {
    failed += 1;
    console.error(
      `  failed ${decision.owner._id.toString()} → ${decision.target._id.toString()}:`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

console.log(
  `\nsuperseded ${superseded} · dropped ${dropped} stale link(s) · failed ${failed} · left as contradictions ${contradictions.length}`,
);
await mongoose.disconnect();
