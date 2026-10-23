import { describe, expect, test } from "bun:test";
import { titleQuerySchema } from "@repo/schemas/stream";

import {
  DECADES,
  DEFAULT_TUNE,
  queryString,
  tuneFromParams,
  tuneToParams,
  tuneToQuery,
} from "./tune";

describe("tune", () => {
  test("the default tuning asks for everything, most popular first", () => {
    expect(tuneToQuery(DEFAULT_TUNE)).toEqual({ sort: "popular" });
  });

  test("dials become a query the API accepts", () => {
    const query = tuneToQuery({
      ...DEFAULT_TUNE,
      time: 4,
      mood: 1,
      acclaim: 3,
      eraFrom: DECADES.indexOf(1980),
      eraTo: DECADES.indexOf(1990),
      kind: "movie",
      q: "  heat ",
    });
    expect(query).toEqual({
      sort: "popular",
      runtimeMax: 130,
      moodMin: -1,
      moodMax: -0.55,
      ratingMin: 7.5,
      yearFrom: 1980,
      yearTo: 1999,
      type: "movie",
      q: "heat",
    });
    const parsed = titleQuerySchema.parse(
      Object.fromEntries(new URLSearchParams(queryString(query))),
    );
    expect(parsed.yearTo).toBe(1999);
    expect(parsed.moodMax).toBe(-0.55);
  });

  test("URL parameters round-trip and reject nonsense", () => {
    const state = {
      ...DEFAULT_TUNE,
      mood: 5,
      kind: "series" as const,
      sort: "rating" as const,
    };
    expect(tuneFromParams(Object.fromEntries(tuneToParams(state)))).toEqual(
      state,
    );
    expect(
      tuneFromParams({ time: "99", kind: "podcast", sort: "random" }),
    ).toEqual(DEFAULT_TUNE);
  });

  test("genres survive navigation and reach the API", () => {
    const state = {
      ...DEFAULT_TUNE,
      genres: ["Comedy", "Thriller"] as ("Comedy" | "Thriller")[],
    };
    expect(tuneFromParams(Object.fromEntries(tuneToParams(state)))).toEqual(
      state,
    );
    expect(titleQuerySchema.parse(tuneToQuery(state)).genres).toEqual(
      state.genres,
    );
    expect(tuneFromParams({ genres: "Comedy,invalid,Comedy" }).genres).toEqual([
      "Comedy",
    ]);
  });

  test("an inverted era is put the right way round", () => {
    const state = tuneFromParams({ from: "8", to: "2" });
    expect(state.eraFrom).toBe(2);
    expect(state.eraTo).toBe(8);
  });
});
