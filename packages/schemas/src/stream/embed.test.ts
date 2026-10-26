import { expect, test } from "bun:test";
import {
  allowEmbedNavigation,
  decodeActorName,
  EMBED_BROWSER_SCRIPT,
  embedPlayerUrl,
  parseEmbedProgress,
  pickSubtitle,
} from "./embed";

const url = "https://vidsrc.mov/embed/tv/tt0944947/2/3";
const event = {
  type: "PLAYER_EVENT",
  data: {
    player_info: { imdb: "tt0944947", mediaType: "tv", season: 2, episode: 3 },
    player_status: "playing",
    player_progress: 125.4,
    player_duration: 3600,
  },
};
test("player messages carry actual timestamps through pause, seek, and completion", () => {
  for (const status of ["playing", "paused", "seeked", "completed"] as const) {
    expect(
      parseEmbedProgress(
        {
          ...event,
          data: {
            ...event.data,
            player_status: status,
            player_progress: status === "completed" ? 3600 : 125.4,
          },
        },
        url,
      ),
    ).toEqual({
      status,
      position: status === "completed" ? 3600 : 125.4,
      duration: 3600,
    });
  }
  expect(parseEmbedProgress(JSON.stringify(event), url)?.position).toBe(125.4);
});
test("events for ads, other episodes, invalid durations and malformed messages are ignored", () => {
  for (const data of [
    { ...event.data, player_duration: 0 },
    { ...event.data, player_duration: Number.POSITIVE_INFINITY },
    { ...event.data, player_progress: -1 },
    { ...event.data, player_progress: 9999 },
    { ...event.data, player_info: { ...event.data.player_info, episode: 4 } },
    {
      ...event.data,
      player_info: { ...event.data.player_info, imdb: "tt1234567" },
    },
    { ...event.data, player_status: "advertisement" },
    { ...event.data, player_status: "completed", player_progress: 5 },
  ])
    expect(parseEmbedProgress({ ...event, data }, url)).toBeNull();
  expect(parseEmbedProgress("not json", url)).toBeNull();
});
test("direct player URL removes the outer advertising wrapper while keeping media identity", () => {
  expect(embedPlayerUrl(url)).toBe(
    "https://vsembed.ru/embed/tv/tt0944947/2-3?autoplay=1",
  );
  expect(
    embedPlayerUrl("https://vidsrc.mov/embed/movie/tt17048514", false),
  ).toBe("https://vsembed.ru/embed/movie/tt17048514?autoplay=0");
});
test("a chosen subtitle is handed to the provider, which then picks none of its own", () => {
  const player = new URL(
    embedPlayerUrl(url, true, {
      url: "https://stream.denizlg24.com/api/public/subtitles/off",
      label: "Off",
      language: "",
    }),
  );
  expect(player.searchParams.get("sub_url")).toBe(
    "https://stream.denizlg24.com/api/public/subtitles/off",
  );
  expect(player.searchParams.get("sub_label")).toBe("Off");
  expect(player.pathname).toBe("/embed/tv/tt0944947/2-3");
});
test("actor routes decode encoded names and Unicode, preserve plus signs and tolerate literal percent signs", () => {
  expect(decodeActorName("Emilia%20Clarke")).toBe("Emilia Clarke");
  expect(decodeActorName("Fran%C3%A7ois%20Cluzet")).toBe("François Cluzet");
  expect(decodeActorName("  O’Neil  ")).toBe("O’Neil");
  expect(decodeActorName("Actor+Name")).toBe("Actor+Name");
  expect(decodeActorName("100% Actor")).toBe("100% Actor");
});
test("native bridge blocks popup creation and only relays events from the active player frame and origin", () => {
  const handlers = new Map<string, (event: any) => void>();
  const sent: string[] = [];
  const frame = { src: "https://player.example.test/embed", contentWindow: {} };
  const window: any = {
    ReactNativeWebView: { postMessage: (value: string) => sent.push(value) },
    addEventListener: (key: string, handler: (event: any) => void) =>
      handlers.set(key, handler),
  };
  const document = {
    getElementById: () => frame,
    addEventListener: (key: string, handler: (event: any) => void) =>
      handlers.set(key, handler),
  };
  new Function("window", "document", EMBED_BROWSER_SCRIPT)(window, document);
  const popup = window.open("https://ad.example.test");
  expect(popup.closed).toBe(false);
  popup.location.href = "https://ad.example.test/landing";
  popup.document.write("<script></script>");
  expect(String(popup)).toBe("");
  expect(() => {
    window.open = () => null;
  }).toThrow();
  const receive = handlers.get("message")!;
  receive({ source: {}, origin: "https://player.example.test", data: event });
  receive({
    source: frame.contentWindow,
    origin: "https://ad.example.test",
    data: event,
  });
  expect(sent).toHaveLength(0);
  receive({
    source: frame.contentWindow,
    origin: "https://player.example.test",
    data: event,
  });
  expect(sent).toEqual([JSON.stringify(event)]);
});

test("native navigation keeps player frames working and rejects click traps and external schemes", () => {
  const player = embedPlayerUrl(url);
  expect(allowEmbedNavigation({ url: player, isTopFrame: true }, player)).toBe(
    true,
  );
  expect(
    allowEmbedNavigation(
      { url: "https://engine.example.test/embed", isTopFrame: false },
      player,
    ),
  ).toBe(true);
  for (const request of [
    { url: "https://ad.example.test", isTopFrame: true },
    {
      url: "https://ad.example.test",
      isTopFrame: false,
      navigationType: "click",
    },
    {
      url: "https://ad.example.test",
      isTopFrame: false,
      navigationType: "formsubmit",
    },
    { url: "https://s10.histats.com", isTopFrame: false },
    { url: "intent://ad.example.test", isTopFrame: false },
    { url: "javascript:alert(1)", isTopFrame: true },
  ])
    expect(allowEmbedNavigation(request, player)).toBe(false);
});

test("a preference resolves to off, a track in that language, or the provider's pick", () => {
  const available = {
    off: "https://stream.test/off",
    tracks: [
      { url: "https://stream.test/fr", label: "French", language: "fr" },
      { url: "https://stream.test/en", label: "English", language: "en" },
      {
        url: "https://stream.test/en2",
        label: "English, version 2",
        language: "en",
      },
    ],
  };
  expect(pickSubtitle(available, "auto")).toBeNull();
  expect(pickSubtitle(available, "off")?.url).toBe("https://stream.test/off");
  expect(pickSubtitle(available, "en")?.url).toBe("https://stream.test/en");
  expect(pickSubtitle(available, "pt")).toBeNull();
  expect(pickSubtitle(null, "off")).toBeNull();
});
