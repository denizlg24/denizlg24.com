import { describe, expect, test } from "bun:test";
import { resolveEmbed } from "./workspace-embeds";

describe("resolveEmbed", () => {
  test("rewrites known providers to their players", () => {
    expect(
      resolveEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s"),
    ).toMatchObject({
      kind: "frame",
      src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=42",
      trusted: true,
    });
    expect(resolveEmbed("https://youtu.be/dQw4w9WgXcQ")).toMatchObject({
      src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    });
    expect(resolveEmbed("https://open.spotify.com/track/abc123")).toMatchObject(
      {
        src: "https://open.spotify.com/embed/track/abc123",
        height: 152,
      },
    );
    expect(resolveEmbed("https://vimeo.com/76979871")).toMatchObject({
      src: "https://player.vimeo.com/video/76979871",
    });
    expect(
      resolveEmbed("https://docs.google.com/document/d/abc/edit#heading=h.1"),
    ).toMatchObject({ src: "https://docs.google.com/document/d/abc/preview" });
    expect(
      resolveEmbed(
        "https://www.google.com/maps/place/Copenhagen/@55.67,12.56,12z",
      ),
    ).toMatchObject({
      src: "https://maps.google.com/maps?q=Copenhagen&output=embed",
    });
  });

  test("direct files become media elements", () => {
    expect(resolveEmbed("https://x.y/a/clip.MP4")?.kind).toBe("video");
    expect(resolveEmbed("https://x.y/song.mp3")?.kind).toBe("audio");
    expect(resolveEmbed("https://x.y/pic.webp")?.kind).toBe("image");
  });

  test("anything else is an untrusted frame; non-web schemes are refused", () => {
    expect(resolveEmbed("https://example.com/page")).toMatchObject({
      kind: "frame",
      trusted: false,
    });
    expect(resolveEmbed("javascript:alert(1)")).toBeNull();
    expect(resolveEmbed("not a url")).toBeNull();
  });
});
