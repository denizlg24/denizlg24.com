import { describe, expect, test } from "bun:test";
import { titleQuerySchema } from "@repo/schemas/stream";
import {
  activeFilterCount,
  describeFilters,
  EMPTY_FILTERS,
  filtersFromQuery,
  parseYear,
  type TitleFilters,
  titleQueryParams,
  titleQueryString,
  toggleGenre,
} from "./title-query";

const filters = (patch: Partial<TitleFilters>): TitleFilters => ({
  ...EMPTY_FILTERS,
  ...patch,
});

describe("titleQueryString", () => {
  test("is empty for the defaults", () => {
    expect(titleQueryString(EMPTY_FILTERS)).toBe("");
  });

  test("omits whitespace-only search text", () => {
    expect(titleQueryString(filters({ q: "   " }))).toBe("");
  });

  test("joins genres with bare commas, in picked order", () => {
    expect(
      titleQueryString(filters({ genres: ["Drama", "Sci-Fi", "Comedy"] })),
    ).toBe("genres=Drama,Sci-Fi,Comedy");
  });

  test("puts a reversed year range the right way round", () => {
    expect(titleQueryParams(filters({ yearFrom: 2010, yearTo: 1990 }))).toEqual(
      { yearFrom: "1990", yearTo: "2010" },
    );
  });

  test("carries the cursor and a non-default page size", () => {
    expect(titleQueryString(EMPTY_FILTERS, 60, 24)).toBe("cursor=60&limit=24");
  });

  test("carries the tuner's runtime and mood window", () => {
    expect(
      titleQueryParams(
        filters({ runtimeMax: 90, moodMin: -0.35, moodMax: 0.35 }),
      ),
    ).toEqual({ runtimeMax: "90", moodMin: "-0.35", moodMax: "0.35" });
  });

  test("encodes search text", () => {
    expect(titleQueryString(filters({ q: "the good & bad" }))).toBe(
      "q=the+good+%26+bad",
    );
  });

  test("round-trips through the server's schema", () => {
    const value = filters({
      q: "alien",
      type: "movie",
      genres: ["Horror", "Sci-Fi"],
      yearFrom: 1979,
      yearTo: 1997,
      ratingMin: 7,
      runtimeMax: 120,
      moodMin: 0.1,
      moodMax: 0.8,
      sort: "rating",
    });
    const params = Object.fromEntries(
      new URLSearchParams(titleQueryString(value, 30)),
    );
    const parsed = titleQuerySchema.parse(params);
    expect(parsed).toMatchObject({
      q: "alien",
      type: "movie",
      genres: ["Horror", "Sci-Fi"],
      yearFrom: 1979,
      yearTo: 1997,
      ratingMin: 7,
      sort: "rating",
      cursor: 30,
    });
    expect(filtersFromQuery(params)).toEqual(value);
  });
});

describe("filtersFromQuery", () => {
  test("reads a rail's query", () => {
    expect(filtersFromQuery({ genres: "Animation", sort: "rating" })).toEqual(
      filters({ genres: ["Animation"], sort: "rating" }),
    );
  });

  test("falls back to the defaults for a query the server would refuse", () => {
    expect(filtersFromQuery({ genres: "Cooking" })).toEqual(EMPTY_FILTERS);
  });
});

describe("filter summaries", () => {
  test("counts each kind of filter once", () => {
    expect(
      activeFilterCount(
        filters({
          q: "x",
          genres: ["Drama", "War"],
          yearTo: 2000,
          sort: "newest",
        }),
      ),
    ).toBe(2);
  });

  test("describes what is in force", () => {
    expect(
      describeFilters(
        filters({
          type: "series",
          genres: ["Crime"],
          yearFrom: 2000,
          ratingMin: 8,
          sort: "newest",
        }),
      ),
    ).toEqual(["Series", "Crime", "From 2000", "Rated 8+", "Newest first"]);
  });

  test("toggles a genre", () => {
    expect(toggleGenre(["Drama"], "War")).toEqual(["Drama", "War"]);
    expect(toggleGenre(["Drama", "War"], "Drama")).toEqual(["War"]);
  });

  test("parses only plausible years", () => {
    expect(parseYear("1994")).toBe(1994);
    expect(parseYear("94")).toBeNull();
    expect(parseYear("3000")).toBeNull();
    expect(parseYear("")).toBeNull();
  });
});
