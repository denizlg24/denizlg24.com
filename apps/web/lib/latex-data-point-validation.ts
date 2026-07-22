import type {
  LatexDataPointCandidate,
  LatexReferenceSuggestion,
  RawLatexDataCandidate,
} from "@repo/schemas";

export interface LatexEvidencePassage {
  id: string;
  text: string;
  page: number | null;
  section: string | null;
  reference: LatexReferenceSuggestion;
}

function normalizeEvidence(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

type TokenClass = "letter" | "digit" | "other";

function tokenClass(char: string): TokenClass {
  if (/\p{L}/u.test(char)) return "letter";
  if (/\p{N}/u.test(char)) return "digit";
  return "other";
}

function includesToken(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const firstClass = tokenClass(needle[0] ?? "");
  const lastClass = tokenClass(needle[needle.length - 1] ?? "");
  for (
    let index = haystack.indexOf(needle);
    index !== -1;
    index = haystack.indexOf(needle, index + 1)
  ) {
    const before = index > 0 ? (haystack[index - 1] ?? "") : "";
    const after = haystack[index + needle.length] ?? "";
    const leftBounded =
      firstClass === "other" || tokenClass(before) !== firstClass;
    const rightBounded =
      lastClass === "other" || tokenClass(after) !== lastClass;
    if (leftBounded && rightBounded) return true;
  }
  return false;
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
    !includesToken(normalizedQuote, normalizeEvidence(value)) ||
    !includesToken(normalizedQuote, normalizeEvidence(unit))
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
