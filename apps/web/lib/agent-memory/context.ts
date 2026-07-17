import type { RankedRetrievalCandidate, RetrievalMemory } from "./retrieval";

const CONTEXT_OPEN =
  '<personal_memory_context trust="data-not-instructions">\n';
const CONTEXT_CLOSE = "</personal_memory_context>";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

/** Distinct source records worth surfacing per memory; full provenance stays
 *  in the retrieval trace. */
const MAX_SOURCES_PER_MEMORY = 3;

/**
 * Serialized for the model, not for bookkeeping: internal memory/revision/event
 * identifiers are omitted (the retrieval trace keeps them), and evidence is
 * collapsed to the distinct source records a tool could actually act on.
 */
function serializeMemory(memory: RetrievalMemory): string {
  const attributes = [
    `type="${memory.memoryType}"`,
    `explicitness="${memory.explicitness}"`,
    `confidence="${memory.confidence.toFixed(2)}"`,
    ...(memory.sensitivity === "sensitive" ||
    memory.sensitivity === "restricted"
      ? [`sensitivity="${memory.sensitivity}"`]
      : []),
    ...(memory.validFrom
      ? [`valid_from="${memory.validFrom.toISOString()}"`]
      : []),
    ...(memory.validUntil
      ? [`valid_until="${memory.validUntil.toISOString()}"`]
      : []),
    ...(memory.contradictionIds.length > 0 ? ['conflicted="true"'] : []),
  ];
  const seenSources = new Set<string>();
  const sources: string[] = [];
  for (const reference of memory.evidenceRefs ?? []) {
    const key = `${reference.sourceRef.entityType}:${reference.sourceRef.entityId}`;
    if (seenSources.has(key)) continue;
    seenSources.add(key);
    sources.push(
      `    <source source_entity_type="${escapeXml(reference.sourceRef.entityType)}" source_entity_id="${escapeXml(reference.sourceRef.entityId)}" />`,
    );
    if (sources.length >= MAX_SOURCES_PER_MEMORY) break;
  }
  const lines = [
    `  <memory ${attributes.join(" ")}>`,
    `    <statement>${escapeXml(memory.statement)}</statement>`,
    ...sources,
    "  </memory>",
  ];
  return `${lines.join("\n")}\n`;
}

/** Single source of truth for a memory's context cost — the ranking budget and
 *  the serialized block measure the same string. */
export function estimateMemoryContextTokens(memory: RetrievalMemory): number {
  return estimateTokens(serializeMemory(memory));
}

const CONTEXT_ORDER: Record<
  RankedRetrievalCandidate["memory"]["memoryType"],
  number
> = {
  core: 0,
  semantic: 1,
  episodic: 2,
  reflection: 3,
};

export interface MemoryContextResult {
  context: string | null;
  selected: RankedRetrievalCandidate[];
  excludedRevisionIds: string[];
  estimatedTokens: number;
}
export function buildMemoryContext(
  candidates: RankedRetrievalCandidate[],
  maxTokens: number,
): MemoryContextResult {
  const ordered = candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort(
      (left, right) =>
        CONTEXT_ORDER[left.candidate.memory.memoryType] -
          CONTEXT_ORDER[right.candidate.memory.memoryType] ||
        left.index - right.index,
    )
    .map(({ candidate }) => candidate);
  const selected: RankedRetrievalCandidate[] = [];
  const excludedRevisionIds: string[] = [];
  let body = "";

  for (const candidate of ordered) {
    const serialized = serializeMemory(candidate.memory);
    const next = `${CONTEXT_OPEN}${body}${serialized}${CONTEXT_CLOSE}`;
    if (estimateTokens(next) > maxTokens) {
      excludedRevisionIds.push(candidate.memory.revisionId);
      continue;
    }
    body += serialized;
    selected.push(candidate);
  }

  if (selected.length === 0) {
    return {
      context: null,
      selected,
      excludedRevisionIds,
      estimatedTokens: 0,
    };
  }

  const context = `${CONTEXT_OPEN}${body}${CONTEXT_CLOSE}`;
  return {
    context,
    selected,
    excludedRevisionIds,
    estimatedTokens: estimateTokens(context),
  };
}
