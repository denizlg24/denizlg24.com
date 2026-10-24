/**
 * What the sofa may see. Like kid-safety, the stricter setting wins: Indian
 * cinema shows only when everyone watching has turned it on.
 */
export interface AudienceRules {
  kids: boolean;
  hideIndianCinema: boolean;
}

/**
 * Original languages of Indian film industries (Bollywood, Kollywood,
 * Tollywood and the rest). Bengali is left out: it is Bangladesh's too.
 * Only TMDB-enriched titles carry a language; unenriched ones pass.
 */
export const INDIAN_LANGUAGES = [
  "hi",
  "ta",
  "te",
  "ml",
  "kn",
  "mr",
  "pa",
  "gu",
];

export function audienceRules(
  profiles: readonly { kids: boolean; showIndianCinema: boolean }[],
): AudienceRules {
  return {
    kids: profiles.some((profile) => profile.kids),
    hideIndianCinema:
      profiles.length === 0 ||
      profiles.some((profile) => !profile.showIndianCinema),
  };
}

/** Distinct sofas with the same people but different rules must not share a cache. */
export function rulesKey(rules: AudienceRules): string {
  return `${rules.kids ? "k" : "a"}${rules.hideIndianCinema ? "h" : "i"}`;
}
