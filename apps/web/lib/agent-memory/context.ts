import type { RankedRetrievalCandidate } from "./retrieval";

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

function serializeMemory(candidate: RankedRetrievalCandidate): string {
  const { memory } = candidate;
  const attributes = [
    `memory_id="${escapeXml(memory.id)}"`,
    `memory_revision_id="${escapeXml(memory.revisionId)}"`,
    `type="${memory.memoryType}"`,
    `explicitness="${memory.explicitness}"`,
    `confidence="${memory.confidence.toFixed(2)}"`,
    `sensitivity="${memory.sensitivity}"`,
    ...(memory.validFrom
      ? [`valid_from="${memory.validFrom.toISOString()}"`]
      : []),
    ...(memory.validUntil
      ? [`valid_until="${memory.validUntil.toISOString()}"`]
      : []),
    ...(memory.contradictionIds.length > 0 ? ['conflicted="true"'] : []),
  ];
  const refsByEventId = new Map(
    memory.evidenceRefs?.map((reference) => [reference.eventId, reference]),
  );
  const evidence = memory.evidenceIds
    .map((eventId) => {
      const reference = refsByEventId.get(eventId);
      if (!reference) {
        return `    <evidence event_id="${escapeXml(eventId)}" provenance_only="true" />`;
      }
      const evidenceAttributes = [
        `event_id="${escapeXml(eventId)}"`,
        `source_type="${escapeXml(reference.sourceType)}"`,
        `source_entity_type="${escapeXml(reference.sourceRef.entityType)}"`,
        `source_entity_id="${escapeXml(reference.sourceRef.entityId)}"`,
        ...(reference.sourceRef.revision
          ? [`source_revision="${escapeXml(reference.sourceRef.revision)}"`]
          : []),
      ];
      return `    <evidence ${evidenceAttributes.join(" ")} />`;
    })
    .join("\n");
  return `  <memory ${attributes.join(" ")}>\n    <statement>${escapeXml(memory.statement)}</statement>\n${evidence}\n  </memory>\n`;
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
    const serialized = serializeMemory(candidate);
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
