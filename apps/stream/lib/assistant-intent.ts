import type { AssistantIntent } from "@repo/schemas/stream";

export const EMPTY_INTENT: AssistantIntent = {
  type: null,
  genres: [],
  excludeGenres: [],
  yearFrom: null,
  yearTo: null,
  runtimeMax: null,
  mood: "any",
  ratingMin: null,
  languages: [],
  similarTo: [],
  keywords: [],
};

const FILLER = new Set([
  "about",
  "film",
  "films",
  "from",
  "good",
  "like",
  "movie",
  "movies",
  "really",
  "series",
  "show",
  "shows",
  "some",
  "something",
  "that",
  "tonight",
  "want",
  "watch",
  "with",
]);

/** Without the model, the prompt's own longer words become plot keywords. */
export function fallbackIntent(prompt: string): AssistantIntent {
  const words = prompt
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 4 && !FILLER.has(word))
    .map((word) => word.slice(0, 40));
  return { ...EMPTY_INTENT, keywords: [...new Set(words)].slice(0, 8) };
}
