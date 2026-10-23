import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EmbedPlayer } from "./embed-player";

test("embedded playback never permits popups, top navigation, downloads or sandbox escape", () => {
  const html = renderToStaticMarkup(
    createElement(EmbedPlayer, {
      title: "Movie",
      playback: {
        embed: {
          provider: "vidsrc",
          url: "https://vidsrc.mov/embed/movie/tt0111161",
        },
        sources: [],
        textTracks: [],
        resume: null,
        next: null,
      },
    }),
  );
  const iframe = html.match(/<iframe\b[^>]+>/)?.[0];
  expect(iframe).toBeDefined();
  const sandbox = iframe?.match(/\bsandbox="([^"]*)"/)?.[1];
  expect(sandbox).toBeDefined();
  const allowed = new Set(sandbox?.split(/\s+/));
  for (const capability of [
    "allow-popups",
    "allow-popups-to-escape-sandbox",
    "allow-top-navigation",
    "allow-top-navigation-by-user-activation",
    "allow-top-navigation-to-custom-protocols",
    "allow-downloads",
  ]) {
    expect(allowed.has(capability)).toBe(false);
  }
  expect(allowed.has("allow-scripts")).toBe(true);
  expect(allowed.has("allow-same-origin")).toBe(true);
});
