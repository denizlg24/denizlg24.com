import { decodeSubtitleToken, toWebVtt } from "@/lib/subtitle-files";

// Fetched by the embed's player from its own origin, so it must allow any.
const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "text/vtt; charset=utf-8",
};

/** `off` has no cues, which the provider reads as "show nothing". */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/public/subtitles/[token]">,
) {
  const { token } = await params;
  if (token === "off") {
    return new Response("WEBVTT\n", {
      headers: { ...HEADERS, "Cache-Control": "public, max-age=86400" },
    });
  }
  const url = decodeSubtitleToken(token);
  if (!url) return new Response("Not found", { status: 404, headers: HEADERS });
  try {
    const response = await fetch(url, {
      next: { revalidate: 6 * 3600 },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return new Response("Unavailable", { status: 502, headers: HEADERS });
    }
    return new Response(toWebVtt(await response.text()), {
      headers: { ...HEADERS, "Cache-Control": "public, max-age=21600" },
    });
  } catch {
    return new Response("Unavailable", { status: 502, headers: HEADERS });
  }
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      ...HEADERS,
      "Access-Control-Allow-Methods": "GET",
      "Access-Control-Max-Age": "86400",
    },
  });
}
