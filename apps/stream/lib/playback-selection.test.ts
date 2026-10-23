import { expect, test } from "bun:test";
import {
  type Episode,
  type Progress,
  playbackSchema,
} from "@repo/schemas/stream";
import { selectPlayback } from "./playback-selection";

const series = { id: "tt0944947", type: "series" };
const episodes: Episode[] = [
  {
    id: "tt0000001",
    seriesId: series.id,
    season: 1,
    episode: 1,
    title: "First",
    runtimeMinutes: 50,
    rating: null,
  },
  {
    id: "tt0000002",
    seriesId: series.id,
    season: 2,
    episode: 1,
    title: "Next season",
    runtimeMinutes: 50,
    rating: null,
  },
];
const progress: Progress = {
  titleId: series.id,
  episodeId: episodes[0]!.id,
  positionS: 0,
  durationS: 0,
  completed: false,
  updatedAt: new Date().toISOString(),
};

test("movie and series embeds use the documented endpoints and a shared selected episode", () => {
  const movie = selectPlayback(
    { id: "tt17048514", type: "movie" },
    [],
    null,
    null,
  );
  expect(movie.embed?.url).toBe("https://vidsrc.mov/embed/movie/tt17048514");
  expect(movie.episode).toBeNull();
  const first = selectPlayback(series, episodes, null, null);
  expect(first.embed?.url).toBe("https://vidsrc.mov/embed/tv/tt0944947/1/1");
  expect(first.episode?.id).toBe(episodes[0]!.id);
  expect(playbackSchema.safeParse(first).success).toBe(true);
});

test("episode-only progress resumes and completed episodes advance across seasons", () => {
  expect(selectPlayback(series, episodes, progress, null).resume).toEqual(
    progress,
  );
  const next = selectPlayback(
    series,
    episodes,
    { ...progress, completed: true },
    null,
  );
  expect(next.episode?.id).toBe(episodes[1]!.id);
  expect(next.resume).toBeNull();
  expect(next.next).toBeNull();
});

test("explicit selection wins, rejects unrelated episodes, and never borrows another episode's clock", () => {
  const selected = selectPlayback(
    series,
    episodes,
    { ...progress, positionS: 300, durationS: 3000 },
    episodes[1]!.id,
  );
  expect(selected.episode?.id).toBe(episodes[1]!.id);
  expect(selected.resume).toBeNull();
  expect(() => selectPlayback(series, episodes, null, "tt9999999")).toThrow(
    RangeError,
  );
  expect(() =>
    selectPlayback(
      { id: "tt17048514", type: "movie" },
      episodes,
      null,
      episodes[0]!.id,
    ),
  ).toThrow(RangeError);
});

test("unknown episode numbers cannot produce embeds; regular seasons open before specials", () => {
  const special = { ...episodes[0]!, id: "tt0000003", season: 0 };
  const unknown = { ...episodes[0]!, id: "tt0000004", episode: null };
  expect(selectPlayback(series, [unknown], null, null).embed).toBeNull();
  expect(
    selectPlayback(series, [special, ...episodes], null, null).episode?.id,
  ).toBe(episodes[0]!.id);
  expect(
    selectPlayback(series, [special, ...episodes], null, special.id).embed?.url,
  ).toEndWith("/0/1");
});

test("the final episode has no next and never loops to the pilot", () => {
  const final = selectPlayback(
    series,
    episodes,
    { ...progress, episodeId: episodes[1]!.id, completed: true },
    null,
  );
  expect(final.episode?.id).toBe(episodes[1]!.id);
  expect(final.next).toBeNull();
});

test("embed contract rejects foreign origins, script injection, and path suffixes", () => {
  const playback = selectPlayback(series, episodes, null, null);
  for (const url of [
    "https://vidsrc.mov.evil.test/embed/movie/123",
    "javascript:alert(1)",
    "https://vidsrc.mov/embed/movie/123?redirect=evil",
    'https://vidsrc.mov/embed/movie/123" onload="alert(1)',
  ]) {
    expect(
      playbackSchema.safeParse({
        ...playback,
        embed: { provider: "vidsrc", url },
      }).success,
    ).toBe(false);
  }
});
