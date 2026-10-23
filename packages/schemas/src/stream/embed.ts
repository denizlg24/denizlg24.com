import { z } from "zod";

const eventSchema = z.object({
  type: z.literal("PLAYER_EVENT"),
  data: z.object({
    player_info: z.object({
      imdb: z.string().nullable(),
      mediaType: z.enum(["movie", "tv"]),
      season: z.number().int().nullable(),
      episode: z.number().int().nullable(),
    }),
    player_status: z.enum(["playing", "paused", "seeked", "completed"]),
    player_progress: z.number().finite().nonnegative(),
    player_duration: z.number().finite().positive(),
  }),
});

export type EmbedProgress = {
  position: number;
  duration: number;
  status: "playing" | "paused" | "seeked" | "completed";
};

/** Match the media as well as the message origin/source checked by the client. */
export function parseEmbedProgress(
  input: unknown,
  embedUrl: string,
): EmbedProgress | null {
  if (typeof input === "string") {
    try {
      input = JSON.parse(input);
    } catch {
      return null;
    }
  }
  const parsed = eventSchema.safeParse(input);
  const media =
    /^https:\/\/vidsrc\.mov\/embed\/(movie|tv)\/(tt\d+)(?:\/(\d+)\/(\d+))?$/.exec(
      embedUrl,
    );
  if (!parsed.success || !media) return null;
  const {
    player_info: info,
    player_status: status,
    player_progress: position,
    player_duration: duration,
  } = parsed.data.data;
  if (info.imdb !== media[2] || info.mediaType !== media[1]) return null;
  if (
    media[1] === "tv" &&
    (info.season !== Number(media[3]) || info.episode !== Number(media[4]))
  )
    return null;
  if (position > duration + 2) return null;
  if (status === "completed" && position < duration - 2) return null;
  return { position: Math.min(position, duration), duration, status };
}

/** The provider behind VidSrc's wrapper relays PLAYER_EVENT and player commands. */
export function embedPlayerUrl(embedUrl: string, autoPlay = true): string {
  const url = new URL(embedUrl);
  url.hostname = "vsembed.ru";
  url.pathname = url.pathname.replace(/\/(\d+)\/(\d+)$/, "/$1-$2");
  url.searchParams.set("autoplay", autoPlay ? "1" : "0");
  return url.toString();
}

export function allowEmbedNavigation(
  request: { url: string; isTopFrame?: boolean; navigationType?: string },
  playerUrl: string,
): boolean {
  if (request.url === "about:blank") return true;
  try {
    const target = new URL(request.url);
    const player = new URL(playerUrl);
    if (target.protocol !== "https:") return false;
    if (target.origin === player.origin && target.pathname === player.pathname)
      return true;
    if (request.isTopFrame !== false) return false;
    // Loading the provider's nested frames is allowed; following an advert isn't.
    if (
      request.navigationType === "click" ||
      request.navigationType === "formsubmit"
    )
      return false;
    return !/(^|\.)(histats\.com|doubleclick\.net|popads\.net|popcash\.net|adsterra\.com)$/.test(
      target.hostname,
    );
  } catch {
    return false;
  }
}

export function decodeActorName(value: string): string {
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
}

/** Remains in the WebView; no credentials or application data are exposed. */
export const EMBED_BROWSER_SCRIPT = `
(function () {
  if (window.__streamBridge) return; window.__streamBridge = true;
  window.open = function () { return null; };
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a');
    if (a && (a.target === '_blank' || a.target === '_top' || a.target === '_parent')) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  window.addEventListener('message', function (e) {
    var frame = document.getElementById('player_iframe');
    if (!frame || e.source !== frame.contentWindow) return;
    try {
      if (e.origin !== new URL(frame.src).origin || !e.data || e.data.type !== 'PLAYER_EVENT') return;
      window.ReactNativeWebView.postMessage(JSON.stringify(e.data));
    } catch (_) {}
  });
})(); true;
`;
