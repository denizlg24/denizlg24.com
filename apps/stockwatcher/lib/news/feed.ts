/** Just enough RSS 2.0 and Atom to read headline feeds, without a dependency. */

export type FeedEntry = {
  title: string;
  link: string;
  time: number;
  summary: string;
  source: string | null;
};

const entities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decode(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
      if (code[0] === "#") {
        const point =
          code[1] === "x" || code[1] === "X"
            ? Number.parseInt(code.slice(2), 16)
            : Number.parseInt(code.slice(1), 10);
        return Number.isFinite(point) ? String.fromCodePoint(point) : match;
      }
      return entities[code.toLowerCase()] ?? match;
    });
}

export const plain = (html: string) =>
  decode(decode(html).replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

function tag(block: string, name: string): string | null {
  const match = block.match(
    new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"),
  );
  return match ? match[1] : null;
}

function atomLink(block: string): string | null {
  const links = [...block.matchAll(/<link\b([^>]*)\/?>/gi)].map(
    (match) => match[1],
  );
  const pick =
    links.find((attrs) => /rel=["']alternate["']/i.test(attrs)) ??
    links.find((attrs) => !/rel=/i.test(attrs)) ??
    links[0];
  return pick?.match(/href=["']([^"']+)["']/i)?.[1] ?? null;
}

const seconds = (raw: string | null) => {
  const parsed = raw ? Date.parse(plain(raw)) : Number.NaN;
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
};

export function parseFeed(xml: string): FeedEntry[] {
  const blocks = [
    ...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi),
    ...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi),
  ].map((match) => match[1]);
  return blocks.flatMap((block) => {
    const title = plain(tag(block, "title") ?? "");
    const rssLink = tag(block, "link");
    const link = decode(
      (rssLink && plain(rssLink)) || atomLink(block) || "",
    ).trim();
    if (!title || !link.startsWith("https://")) return [];
    return [
      {
        title,
        link,
        time: seconds(
          tag(block, "pubDate") ??
            tag(block, "published") ??
            tag(block, "updated") ??
            tag(block, "dc:date"),
        ),
        summary: plain(
          tag(block, "description") ??
            tag(block, "summary") ??
            tag(block, "content") ??
            "",
        ).slice(0, 600),
        source: (() => {
          const value = tag(block, "source");
          return value ? plain(value) : null;
        })(),
      },
    ];
  });
}
