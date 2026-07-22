import type {
  LatexDataPointCandidate,
  LatexReferenceSuggestion,
} from "@repo/schemas";

export interface LatexEvidencePassage {
  id: string;
  text: string;
  page: number | null;
  section: string | null;
  reference: LatexReferenceSuggestion;
}

export interface RawLatexDataCandidate {
  sourceId: string;
  value: string;
  unit: string;
  population: string | null;
  geography: string | null;
  period: string | null;
  methodologyQualifier: string | null;
  supportingPassage: string;
}

function normalizeEvidence(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function boundedNullable(value: string | null, length: number): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, length) : null;
}

export function verifyLatexDataCandidate(
  raw: RawLatexDataCandidate,
  passages: Map<string, LatexEvidencePassage>,
): LatexDataPointCandidate | null {
  const source = passages.get(raw.sourceId);
  const quote = raw.supportingPassage.trim();
  const value = raw.value.trim();
  const unit = raw.unit.trim();
  if (!source || !quote || !value || !unit || !/\d/.test(value)) return null;

  const normalizedSource = normalizeEvidence(source.text);
  const normalizedQuote = normalizeEvidence(quote);
  if (
    !normalizedSource.includes(normalizedQuote) ||
    !normalizedQuote.includes(normalizeEvidence(value)) ||
    !normalizedQuote.includes(normalizeEvidence(unit))
  ) {
    return null;
  }

  return {
    id: crypto.randomUUID(),
    value: value.slice(0, 100),
    unit: unit.slice(0, 100),
    population: boundedNullable(raw.population, 500),
    geography: boundedNullable(raw.geography, 300),
    period: boundedNullable(raw.period, 200),
    methodologyQualifier: boundedNullable(raw.methodologyQualifier, 1_000),
    supportingPassage: quote.slice(0, 4_000),
    page: source.page,
    section: source.section,
    verified: true,
    reference: source.reference,
  };
}

export function verifiedLatexDataCandidates(
  rawCandidates: RawLatexDataCandidate[],
  passages: LatexEvidencePassage[],
  limit: number,
): { candidates: LatexDataPointCandidate[]; rejectedCandidates: number } {
  const passageMap = new Map(passages.map((passage) => [passage.id, passage]));
  const candidates: LatexDataPointCandidate[] = [];
  const seen = new Set<string>();
  let rejectedCandidates = 0;

  for (const raw of rawCandidates) {
    const candidate = verifyLatexDataCandidate(raw, passageMap);
    if (!candidate) {
      rejectedCandidates += 1;
      continue;
    }
    const key = [
      candidate.reference.openAlexId ?? candidate.reference.paperId,
      normalizeEvidence(candidate.value),
      normalizeEvidence(candidate.unit),
      normalizeEvidence(candidate.supportingPassage),
    ].join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(candidate);
    if (candidates.length >= limit) break;
  }
  return { candidates, rejectedCandidates };
}
