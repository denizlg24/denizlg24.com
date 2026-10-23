import { describe, expect, test } from "bun:test";
import { languagePreferences, preferenceScore } from "./recommendation-ranking";

const title = {
  id: "tt1234567",
  title: "Example",
  year: 2020,
  type: "movie" as const,
  genres: ["Comedy", "Thriller"],
  rating: 7.5,
  originalLanguage: "en",
};
describe("recommendation preferences", () => {
  test("starts conservatively and learns language interest only from positive history", () => {
    expect(languagePreferences([])).toEqual(["en"]);
    expect(
      languagePreferences([
        { ...title, originalLanguage: "hi", signal: "abandoned" },
      ]),
    ).toEqual(["en"]);
    expect(
      languagePreferences([
        { ...title, signal: "finished" },
        { ...title, originalLanguage: "hi", signal: "watchlist" },
      ]),
    ).toEqual(["en", "hi"]);
  });
  test("common ground beats a one-person obsession for group viewing", () => {
    const group = [
      new Map([
        ["Comedy", 3],
        ["Thriller", 3],
      ]),
      new Map([
        ["Comedy", 3],
        ["Thriller", -3],
      ]),
    ];
    expect(
      preferenceScore({ ...title, genres: ["Comedy"] }, group),
    ).toBeGreaterThan(
      preferenceScore({ ...title, genres: ["Thriller"] }, group),
    );
  });
  test("negative viewing signals lower ranking", () => {
    expect(preferenceScore(title, [new Map([["Comedy", 3]])])).toBeGreaterThan(
      preferenceScore(title, [new Map([["Comedy", -3]])]),
    );
  });
});
