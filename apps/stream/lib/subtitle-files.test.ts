import { expect, test } from "bun:test";

import {
  decodeSubtitleToken,
  encodeSubtitleToken,
  type Result,
  toTracks,
  toWebVtt,
} from "./subtitle-files";

const result = (patch: Partial<Result>): Result => ({
  id: "1",
  url: "https://sub.wyzie.io/c/abc/id/1?format=srt&tok=x",
  format: "srt",
  display: "English",
  language: "en",
  isHearingImpaired: false,
  release: null,
  downloadCount: 0,
  ai: false,
  ...patch,
});

test("only Wyzie downloads round-trip through a token", () => {
  const url = "https://sub.wyzie.io/c/abc/id/1?format=srt&tok=x";
  expect(decodeSubtitleToken(encodeSubtitleToken(url))).toBe(url);
  for (const other of [
    "https://example.com/c/abc",
    "http://sub.wyzie.io/c/abc",
    "https://sub.wyzie.io/search?id=tt1",
  ])
    expect(decodeSubtitleToken(encodeSubtitleToken(other))).toBeNull();
  expect(decodeSubtitleToken("%%%")).toBeNull();
});

test("the free plan's advert cue is dropped", () => {
  expect(
    toWebVtt(
      "1\n00:00:00,000 --> 00:00:06,000\nYou're on the free plan. Unlock every source → store.wyzie.io\n\n2\n00:01:14,908 --> 00:01:17,094\nWell, my dad was a farmer.\n",
    ),
  ).toBe(
    "WEBVTT\n\n2\n00:01:14.908 --> 00:01:17.094\nWell, my dad was a farmer.\n",
  );
});

test("SRT becomes WebVTT with dotted milliseconds", () => {
  expect(toWebVtt("﻿1\r\n00:00:01,500 --> 00:00:03,250\r\nHello\r\n")).toBe(
    "WEBVTT\n\n1\n00:00:01.500 --> 00:00:03.250\nHello\n",
  );
  expect(toWebVtt("WEBVTT\n\n00:01.000 --> 00:02.000\nHi")).toBe(
    "WEBVTT\n\n00:01.000 --> 00:02.000\nHi\n",
  );
});

test("versions are numbered within the name shown, not the language code", () => {
  const tracks = toTracks(
    [
      result({
        id: "pt1",
        display: "Portuguese",
        language: "pt",
        downloadCount: 9,
      }),
      result({
        id: "br1",
        display: "Brazilian",
        language: "pt",
        downloadCount: 8,
      }),
      result({
        id: "br2",
        display: "Brazilian",
        language: "pt",
        downloadCount: 7,
      }),
    ],
    "https://stream.test",
  );
  expect(tracks.map((track) => track.label)).toEqual([
    "Brazilian",
    "Brazilian, version 2",
    "Portuguese",
  ]);
});

test("tracks rank human, plain and popular first, keep three a language, sort by name", () => {
  const tracks = toTracks(
    [
      result({ id: "ai", ai: true, downloadCount: 900 }),
      result({ id: "hi", isHearingImpaired: true, downloadCount: 800 }),
      result({ id: "low", downloadCount: 10 }),
      result({ id: "top", downloadCount: 500 }),
      result({ id: "fr", display: "French", language: "fr" }),
      result({ id: "bad", language: "english" }),
    ],
    "https://stream.test",
  );
  expect(tracks.map((track) => track.id)).toEqual(["top", "low", "hi", "fr"]);
  expect(tracks[0].label).toBe("English");
  expect(tracks[1].label).toBe("English, version 2");
  expect(tracks[2].label).toBe("English, for the hard of hearing, version 3");
  expect(
    tracks[0].url.startsWith("https://stream.test/api/public/subtitles/"),
  ).toBe(true);
});
