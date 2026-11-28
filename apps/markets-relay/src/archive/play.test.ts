import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parsePlayPage } from "./play";
import { loadPlayApps } from "./play-apps";

const fixture = readFileSync(
  new URL("./fixtures/play-minimal.html", import.meta.url),
  "utf8",
);

test("extracts rating, count, installs, updated date and version", () => {
  expect(parsePlayPage(fixture)).toEqual({
    rating: 4.348067760467529,
    ratingsCount: 36693031,
    installs: "1B+",
    updated: "2026-11-24",
    version: "9.1.78.2218",
  });
});

test("records nulls for what a page does not carry", () => {
  expect(
    parsePlayPage("<html><body>Before you continue</body></html>"),
  ).toEqual({
    rating: null,
    ratingsCount: null,
    installs: null,
    updated: null,
    version: null,
  });
});

test("rejects an out-of-range rating instead of storing it", () => {
  const html = fixture.replace('"4.348067760467529"', '"43.4"');
  expect(parsePlayPage(html).rating).toBeNull();
});

test("keeps the version null when Play shows none", () => {
  const html = fixture.replace('"9.1.78.2218"', "null");
  expect(parsePlayPage(html).version).toBeNull();
});

test("reads an inline app list override", () => {
  expect(
    loadPlayApps('[{"ticker":"meta","package":"com.facebook.katana"}]'),
  ).toEqual([{ ticker: "META", package: "com.facebook.katana" }]);
});

test("rejects a malformed package id", () => {
  expect(() => loadPlayApps('[{"ticker":"X","package":"a b;c"}]')).toThrow();
});
