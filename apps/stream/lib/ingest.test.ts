import { describe, expect, test } from "bun:test";

import { packEpisode, unpackEpisode } from "./ingest";

describe("packEpisode", () => {
  test("round-trips every field, including the missing ones", () => {
    for (const input of [
      [0, 1, 1, 8.4],
      [999_999, 2046, 510, 10],
      [42, null, null, null],
      [7, 3, 12, 0.1],
    ] as const) {
      const [seriesIndex, season, episode, rating] = input;
      expect(
        unpackEpisode(packEpisode(seriesIndex, season, episode, rating)),
      ).toEqual({
        seriesIndex,
        season,
        episode,
        rating,
      });
    }
  });

  test("out-of-range numbering reads as missing rather than corrupting the series", () => {
    expect(unpackEpisode(packEpisode(5, 5000, 9000, 7)).seriesIndex).toBe(5);
    expect(unpackEpisode(packEpisode(5, 5000, 9000, 7)).season).toBeNull();
  });
});
