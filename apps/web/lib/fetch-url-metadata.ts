import { fetchFavicon } from "@/lib/fetch-favicon";

export interface UrlMetadata {
  url: string;
  title: string;
  description?: string;
  favicon?: string;
  image?: string;
  siteName?: string;
}

const META_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 2 * 1024 * 1024; // 2MB (YouTube etc. have huge inline JSON before og tags)

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

function matchMeta(
  html: string,
  attr: "property" | "name",
  key: string,
): string | undefined {
  const re = new RegExp(
    `<meta[^>]+${attr}=["']${key}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    "i",
  );
  const m = html.match(re);
  if (m) return decodeEntities(m[1]);
  const reAlt = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+${attr}=["']${key}["'][^>]*>`,
    "i",
  );
  const m2 = html.match(reAlt);
  return m2 ? decodeEntities(m2[1]) : undefined;
}

function matchTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? decodeEntities(m[1].trim()) : undefined;
}

function resolveUrl(base: string, href: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

export async function fetchUrlMetadata(rawUrl: string): Promise<UrlMetadata> {
  let url: string;
  try {
    url = new URL(rawUrl).toString();
  } catch {
    throw new Error("Invalid URL");
  }

  const hostname = new URL(url).hostname;
  let html = "";

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), META_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
        "accept-encoding": "gzip, deflate, br",
      },
      redirect: "follow",
    });
    clearTimeout(timer);

    if (
      res.ok &&
      (res.headers.get("content-type") || "").includes("text/html")
    ) {
      const reader = res.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder();
        let received = 0;
        while (received < MAX_HTML_BYTES) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.length;
          html += decoder.decode(value, { stream: true });
        }
        try {
          await reader.cancel();
        } catch {}
      } else {
        html = await res.text();
      }
    }
  } catch {}

  const ogTitle = matchMeta(html, "property", "og:title");
  const ogDesc = matchMeta(html, "property", "og:description");
  const ogImage = matchMeta(html, "property", "og:image");
  const ogSite = matchMeta(html, "property", "og:site_name");
  const twTitle = matchMeta(html, "name", "twitter:title");
  const twDesc = matchMeta(html, "name", "twitter:description");
  const twImage = matchMeta(html, "name", "twitter:image");
  const metaDesc = matchMeta(html, "name", "description");

  const title = ogTitle || twTitle || matchTitle(html) || hostname;
  const description = ogDesc || twDesc || metaDesc;
  const image = ogImage
    ? resolveUrl(url, ogImage)
    : twImage
      ? resolveUrl(url, twImage)
      : undefined;
  const siteName = ogSite || hostname;

  const favicon = await fetchFavicon(url);

  return { url, title, description, favicon, image, siteName };
}
