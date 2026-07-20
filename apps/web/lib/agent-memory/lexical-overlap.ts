export function keywordTerms(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
}

export function keywordOverlap(queryTerms: Set<string>, value: string): number {
  let score = 0;
  for (const term of keywordTerms(value)) {
    if (queryTerms.has(term)) score += 1;
  }
  return score;
}
