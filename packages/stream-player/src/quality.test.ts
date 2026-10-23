import { describe, expect, test } from "bun:test";
import type { PlaybackSource } from "@repo/schemas/stream";
import { pickSource, playableSourceIndices, qualityOptions } from "./quality";

function source(
  height: number | null,
  mimeType = "video/mp4",
  label = "",
): PlaybackSource {
  return {
    url: `https://storage.example/${height ?? "x"}.${mimeType.split("/")[1]}`,
    mimeType,
    label,
    height,
  };
}

const ladder = [source(720), source(2160, "video/mp4", "4K"), source(1080)];
const all = [0, 1, 2];

describe("playableSourceIndices", () => {
  test("keeps what the browser can play and anything untyped", () => {
    const sources = [source(720, "video/webm"), source(1080), source(480, "")];
    expect(
      playableSourceIndices(sources, (mime) => mime === "video/mp4"),
    ).toEqual([1, 2]);
  });
});

describe("qualityOptions", () => {
  test("tallest first, labelled by the source or its height", () => {
    expect(qualityOptions(ladder, all)).toEqual([
      { index: 1, label: "4K", height: 2160 },
      { index: 2, label: "1080p", height: 1080 },
      { index: 0, label: "720p", height: 720 },
    ]);
  });

  test("no menu without a real choice", () => {
    expect(qualityOptions([source(1080), source(1080)], [0, 1])).toEqual([]);
    expect(qualityOptions([source(null), source(720)], [0, 1])).toEqual([]);
    expect(qualityOptions(ladder, [2])).toEqual([]);
  });

  test("duplicate heights keep the first", () => {
    const sources = [source(720), source(720, "video/webm"), source(1080)];
    expect(qualityOptions(sources, [0, 1, 2]).map((o) => o.index)).toEqual([
      2, 0,
    ]);
  });
});

describe("pickSource", () => {
  test("tallest that fits the screen", () => {
    expect(pickSource(ladder, all, 1440)).toBe(2);
    expect(pickSource(ladder, all, 2160)).toBe(1);
  });

  test("shortest when nothing fits, tallest without a target", () => {
    expect(pickSource(ladder, all, 480)).toBe(0);
    expect(pickSource(ladder, all, null)).toBe(1);
  });

  test("only playable sources are considered", () => {
    expect(pickSource(ladder, [0, 2], null)).toBe(2);
    expect(pickSource(ladder, [], 1080)).toBeNull();
  });

  test("first playable when no source has a height", () => {
    expect(pickSource([source(null), source(null)], [1], 1080)).toBe(1);
  });
});
