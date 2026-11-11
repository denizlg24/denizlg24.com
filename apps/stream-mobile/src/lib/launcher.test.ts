import { describe, expect, test } from "bun:test";
import type { Browse, TitleSummary } from "@repo/schemas/stream";
import { launcherItems } from "./launcher";

function title(id: string, name: string, backdropPath: string | null) {
  return {
    id,
    type: "series",
    title: name,
    startYear: 2022,
    endYear: null,
    runtimeMinutes: null,
    genres: [],
    rating: null,
    votes: 0,
    posterPath: null,
    backdropPath,
  } satisfies TitleSummary;
}

const home: Browse = {
  tab: "home",
  billboard: null,
  rows: [
    {
      kind: "continue",
      id: "continue",
      label: "Continue watching",
      items: [
        {
          title: title("tt1", "The Bear", "/bear.jpg"),
          progress: {
            titleId: "tt1",
            episodeId: "tt9",
            positionS: 600.4,
            durationS: 1800,
            completed: false,
            updatedAt: "2026-11-10T20:00:00.000Z",
          },
          episode: { season: 2, episode: 3, title: "Sundae" },
        },
        {
          title: title("tt2", "Heat", null),
          progress: {
            titleId: "tt2",
            episodeId: null,
            positionS: 60,
            durationS: 10200,
            completed: false,
            updatedAt: "2026-11-09T20:00:00.000Z",
          },
        },
      ],
    },
  ],
};

describe("launcherItems", () => {
  test("an episode in progress links to that episode", () => {
    expect(launcherItems(home)?.[0]).toEqual({
      title: "The Bear",
      subtitle: "S2 E3",
      uri: "stream://tv/watch/tt1?episode=tt9",
      image: "https://image.tmdb.org/t/p/w1280/bear.jpg",
      positionMs: 600400,
      durationMs: 1800000,
      updatedAt: Date.parse("2026-11-10T20:00:00.000Z"),
    });
  });

  test("a film has no episode and may have no artwork", () => {
    expect(launcherItems(home)?.[1]).toMatchObject({
      title: "Heat",
      subtitle: null,
      uri: "stream://tv/watch/tt2",
      image: null,
    });
  });

  test("home with nothing in progress publishes an empty list", () => {
    expect(launcherItems({ ...home, rows: [] })).toEqual([]);
  });

  test("other tabs say nothing", () => {
    expect(launcherItems({ ...home, tab: "films" })).toBeNull();
  });
});
