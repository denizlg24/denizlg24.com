import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EmbedPlayer } from "./embed-player";

test("the provider loads unsandboxed and the click shield waits for the player to report", () => {
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
  expect(iframe).toContain('src="https://vsembed.ru/embed/movie/tt0111161');
  expect(iframe).not.toContain("sandbox");
  expect(html).not.toContain("data-embed-shield");
});
