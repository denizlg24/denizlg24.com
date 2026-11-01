/**
 * What an `embed` block shows for a pasted URL: a known provider's player,
 * a media element for a direct file, or the page itself in a sandboxed frame.
 */
export type EmbedSource =
  | {
      kind: "frame";
      src: string;
      provider: string;
      /** width / height; null for a fixed height. */
      aspect: number | null;
      /** Height in px when the provider has a fixed one. */
      height?: number;
      /** Pages we know nothing about get no same-origin or top navigation. */
      trusted: boolean;
    }
  | { kind: "video" | "audio" | "image"; src: string; provider: string };

const VIDEO = /\.(mp4|webm|mov|m4v|ogv)$/i;
const AUDIO = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus)$/i;
const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;

function parse(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function frame(
  src: string,
  provider: string,
  aspect: number | null,
  height?: number,
): EmbedSource {
  return {
    kind: "frame",
    src,
    provider,
    aspect,
    ...(height ? { height } : {}),
    trusted: true,
  };
}

function youtubeId(url: URL): string | null {
  const host = url.hostname.replace(/^www\.|^m\./, "");
  if (host === "youtu.be") return url.pathname.slice(1).split("/")[0] || null;
  if (host !== "youtube.com" && host !== "youtube-nocookie.com") return null;
  if (url.pathname === "/watch") return url.searchParams.get("v");
  const match = url.pathname.match(/^\/(?:embed|shorts|live)\/([^/?]+)/);
  return match?.[1] ?? null;
}

export function resolveEmbed(raw: string): EmbedSource | null {
  const url = parse(raw.trim());
  if (!url) return null;
  const host = url.hostname.replace(/^www\./, "");
  const path = url.pathname;

  const yt = youtubeId(url);
  if (yt && /^[\w-]{6,20}$/.test(yt)) {
    const start = url.searchParams.get("t")?.replace(/s$/, "");
    const query = start && /^\d+$/.test(start) ? `?start=${start}` : "";
    return frame(
      `https://www.youtube-nocookie.com/embed/${yt}${query}`,
      "YouTube",
      16 / 9,
    );
  }
  if (host === "vimeo.com") {
    const id = path.match(/^\/(\d+)/)?.[1];
    if (id)
      return frame(`https://player.vimeo.com/video/${id}`, "Vimeo", 16 / 9);
  }
  if (host === "open.spotify.com") {
    const match = path.match(
      /^\/(?:intl-[a-z-]+\/)?(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]+)/,
    );
    if (match) {
      const [, type, id] = match;
      const compact = type === "track" || type === "episode";
      return frame(
        `https://open.spotify.com/embed/${type}/${id}`,
        "Spotify",
        null,
        compact ? 152 : 352,
      );
    }
  }
  if (host === "soundcloud.com") {
    return frame(
      `https://w.soundcloud.com/player/?url=${encodeURIComponent(url.toString())}`,
      "SoundCloud",
      null,
      166,
    );
  }
  if (host === "figma.com" && /^\/(file|design|proto|board)\//.test(path)) {
    return frame(
      `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(url.toString())}`,
      "Figma",
      16 / 10,
    );
  }
  if (host === "loom.com") {
    const id = path.match(/^\/(?:share|embed)\/([a-f0-9]+)/)?.[1];
    if (id) return frame(`https://www.loom.com/embed/${id}`, "Loom", 16 / 9);
  }
  if (host === "codepen.io") {
    const match = path.match(/^\/([^/]+)\/(?:pen|embed)\/([^/?]+)/);
    if (match) {
      return frame(
        `https://codepen.io/${match[1]}/embed/${match[2]}?default-tab=result`,
        "CodePen",
        null,
        400,
      );
    }
  }
  if (host === "docs.google.com") {
    const match = path.match(
      /^\/(document|spreadsheets|presentation|forms)\/d\/([^/]+)/,
    );
    if (match) {
      const [, type, id] = match;
      const suffix =
        type === "presentation"
          ? "embed"
          : type === "forms"
            ? "viewform?embedded=true"
            : "preview";
      return frame(
        `https://docs.google.com/${type}/d/${id}/${suffix}`,
        "Google Docs",
        type === "presentation" ? 16 / 9 : null,
        type === "presentation" ? undefined : 560,
      );
    }
  }
  if (
    (host === "google.com" || host.endsWith(".google.com")) &&
    path.startsWith("/maps")
  ) {
    const place = path.match(/^\/maps\/(?:place|search)\/([^/]+)/)?.[1];
    const coords = path.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    const query =
      url.searchParams.get("q") ??
      (place ? decodeURIComponent(place.replace(/\+/g, " ")) : null) ??
      (coords ? `${coords[1]},${coords[2]}` : null);
    if (query) {
      return frame(
        `https://maps.google.com/maps?q=${encodeURIComponent(query)}&output=embed`,
        "Google Maps",
        16 / 10,
      );
    }
  }
  if (host === "openstreetmap.org") {
    const map = url.hash.match(/map=(\d+)\/(-?[\d.]+)\/(-?[\d.]+)/);
    if (map) {
      const [, zoom, lat, lon] = map;
      const span = 360 / 2 ** Number(zoom);
      const bbox = [
        Number(lon) - span,
        Number(lat) - span / 2,
        Number(lon) + span,
        Number(lat) + span / 2,
      ].join(",");
      return frame(
        `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lon}`,
        "OpenStreetMap",
        16 / 10,
      );
    }
  }

  if (VIDEO.test(path))
    return { kind: "video", src: url.toString(), provider: host };
  if (AUDIO.test(path))
    return { kind: "audio", src: url.toString(), provider: host };
  if (IMAGE.test(path))
    return { kind: "image", src: url.toString(), provider: host };

  return {
    kind: "frame",
    src: url.toString(),
    provider: host,
    aspect: null,
    height: 480,
    trusted: false,
  };
}
