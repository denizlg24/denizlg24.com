import { describe, expect, test } from "bun:test";

import {
  buildTaste,
  diversify,
  type EngineTitle,
  preferredLanguages,
  quality,
  scoreTitle,
  tasteMatch,
  titleSimilarity,
} from "./taste";

const now = new Date("2026-11-09T12:00:00Z");

function title(overrides: Partial<EngineTitle> & { id: string }): EngineTitle {
  return {
    type: "movie",
    title: overrides.id,
    genres: ["Drama"],
    keywords: [],
    people: [],
    directors: [],
    originalLanguage: "en",
    startYear: 2015,
    rating: 7.5,
    votes: 200_000,
    popularity: 4,
    tmdbPopularity: 20,
    tmdbId: null,
    related: [],
    releaseDate: null,
    ...overrides,
  };
}

const heist = title({
  id: "tt0000001",
  genres: ["Crime", "Thriller"],
  keywords: ["heist", "bank robbery"],
  people: ["Ana Actor", "Rui Director"],
  directors: ["Rui Director"],
});
const anotherHeist = title({
  id: "tt0000002",
  genres: ["Crime", "Comedy"],
  keywords: ["heist"],
  people: ["Ana Actor"],
});
const romance = title({
  id: "tt0000003",
  genres: ["Romance", "Comedy"],
  keywords: ["wedding"],
});

describe("taste", () => {
  test("a finished title pulls similar titles above unrelated ones", () => {
    const taste = buildTaste(
      [{ title: heist, signal: "finished", at: now }],
      [],
      now,
    );
    expect(tasteMatch(anotherHeist, taste)).toBeGreaterThan(
      tasteMatch(romance, taste),
    );
  });

  test("abandoning a title pushes its kind down", () => {
    const taste = buildTaste(
      [{ title: romance, signal: "abandoned", at: now }],
      [],
      now,
    );
    expect(tasteMatch(romance, taste)).toBeLessThan(0);
    expect(taste.seeds).toHaveLength(0);
    expect(taste.seen.has(romance.id)).toBe(true);
  });

  test("old history counts for less than recent history", () => {
    const old = new Date("2024-11-09T12:00:00Z");
    const taste = buildTaste(
      [
        { title: romance, signal: "finished", at: old },
        { title: heist, signal: "finished", at: now },
      ],
      [],
      now,
    );
    expect(taste.seeds[0].title.id).toBe(heist.id);
  });

  test("favourite genres alone give a direction", () => {
    const taste = buildTaste([], ["Romance"], now);
    expect(taste.empty).toBe(false);
    expect(tasteMatch(romance, taste)).toBeGreaterThan(
      tasteMatch(heist, taste),
    );
  });
});

describe("scoring", () => {
  test("TMDB's recommendation of a seed lifts a candidate", () => {
    const seedTitle = { ...heist, tmdbId: 10, related: [20] };
    const taste = buildTaste(
      [{ title: seedTitle, signal: "finished", at: now }],
      [],
      now,
    );
    const candidate = { ...romance, tmdbId: 20 };
    const plain = scoreTitle(candidate, {
      tastes: [taste],
      languages: new Set(["en"]),
      relatedTo: new Map(),
      now,
    });
    const boosted = scoreTitle(candidate, {
      tastes: [taste],
      languages: new Set(["en"]),
      relatedTo: new Map([["movie:20", taste.seeds[0]]]),
      now,
    });
    expect(boosted.score).toBeGreaterThan(plain.score);
    expect(boosted.because?.title.id).toBe(heist.id);
  });

  test("a group pick needs common ground", () => {
    const likesHeists = buildTaste(
      [{ title: heist, signal: "finished", at: now }],
      [],
      now,
    );
    const hatesHeists = buildTaste(
      [{ title: heist, signal: "abandoned", at: now }],
      [],
      now,
    );
    const context = (tastes: (typeof likesHeists)[]) => ({
      tastes,
      languages: new Set(["en"]),
      relatedTo: new Map(),
      now,
    });
    expect(
      scoreTitle(anotherHeist, context([likesHeists])).score,
    ).toBeGreaterThan(
      scoreTitle(anotherHeist, context([likesHeists, hatesHeists])).score,
    );
  });

  test("a little-voted perfect score does not beat a widely loved film", () => {
    expect(quality({ ...romance, rating: 9.4, votes: 150 })).toBeLessThan(
      quality({ ...romance, rating: 8.5, votes: 2_000_000 }),
    );
  });

  test("diversify avoids near-duplicates at the top", () => {
    const sequel = { ...heist, id: "tt0000009" };
    const scored = [
      { title: heist, score: 3, match: 1, because: null },
      { title: sequel, score: 2.95, match: 1, because: null },
      { title: romance, score: 2.6, match: 0.2, because: null },
    ];
    expect(titleSimilarity(heist, sequel)).toBeCloseTo(1);
    expect(diversify(scored, 2).map((item) => item.title.id)).toEqual([
      heist.id,
      romance.id,
    ]);
  });

  test("languages start at English and learn from viewing", () => {
    const korean = { ...heist, id: "tt0000010", originalLanguage: "ko" };
    expect([...preferredLanguages([buildTaste([], [], now)])]).toEqual(["en"]);
    const taste = buildTaste(
      [{ title: korean, signal: "finished", at: now }],
      [],
      now,
    );
    expect(preferredLanguages([taste]).has("ko")).toBe(true);
  });
});
