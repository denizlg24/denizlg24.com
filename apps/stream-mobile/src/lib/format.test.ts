import { describe, expect, test } from "bun:test";
import { combinedRuntime, episodeLabel, listNames, titleFacts } from "./format";

describe("titleFacts", () => {
  test("a film", () => {
    expect(
      titleFacts({
        type: "movie",
        startYear: 1994,
        endYear: null,
        runtimeMinutes: 142,
        certification: "15",
        rating: 9.3,
      }),
    ).toEqual({
      rating: "9.3",
      kind: "Film",
      years: "1994",
      runtime: "2h 22m",
      certification: "15",
    });
  });

  test("a series leaves out what it doesn't know", () => {
    expect(
      titleFacts({
        type: "series",
        startYear: 2008,
        endYear: 2013,
        runtimeMinutes: 47,
        rating: null,
      }),
    ).toEqual({
      rating: null,
      kind: "Series",
      years: "2008–2013",
      runtime: null,
      certification: null,
    });
  });
});

test("combinedRuntime", () => {
  expect(combinedRuntime(101, 120)).toBe("3h 41m together");
  expect(combinedRuntime(null, 120)).toBeNull();
});

test("episodeLabel", () => {
  expect(episodeLabel(1, 3)).toBe("Season 1, episode 3");
  expect(episodeLabel(null, 3)).toBe("Episode 3");
  expect(episodeLabel(2, null)).toBeNull();
});

test("listNames", () => {
  expect(listNames([])).toBe("");
  expect(listNames(["Ana"])).toBe("Ana");
  expect(listNames(["Ana", "Bo", "Cy"])).toBe("Ana, Bo and Cy");
});
