import { describe, expect, test } from "bun:test";
import { canonicalUrl, dedupe, similar, titleWords } from "./dedupe";
import { parseFeed } from "./feed";
import type { NewsItem } from "./types";

const item = (overrides: Partial<NewsItem>): NewsItem => ({
  id: "x",
  source: "yahoo",
  publisher: "P",
  title: "Nvidia beats estimates as data center revenue jumps 60%",
  url: "https://example.com/a",
  time: 1_000,
  symbols: ["NVDA"],
  ...overrides,
});

describe("dedupe", () => {
  test("strips tracking parameters and www when comparing links", () => {
    expect(canonicalUrl("https://www.x.com/story/?utm_source=a&id=7#top")).toBe(
      canonicalUrl("https://x.com/story?id=7"),
    );
  });

  test("treats near-identical headlines as one story", () => {
    expect(
      similar(
        titleWords(
          "Nvidia beats estimates as data center revenue jumps 60% - Reuters",
        ),
        titleWords("Nvidia Beats Estimates as Data-Center Revenue Jumps 60%"),
      ),
    ).toBe(true);
    expect(
      similar(
        titleWords("Nvidia beats estimates as data center revenue jumps"),
        titleWords("Apple unveils new iPhone lineup at September event"),
      ),
    ).toBe(false);
  });

  test("the filing keeps its headline, every source adds symbols, earliest time wins", () => {
    const merged = dedupe([
      item({
        id: "g",
        source: "google",
        url: "https://news.example/a",
        time: 900,
        symbols: ["NVDA"],
      }),
      item({
        id: "s",
        source: "sec",
        url: "https://sec.gov/x",
        time: 1_200,
        symbols: ["AMD"],
      }),
      item({
        id: "o",
        title: "Unrelated headline about something else entirely",
        url: "https://o.example/b",
        time: 500,
      }),
    ]);
    expect(merged).toHaveLength(2);
    const story = merged.find((entry) => entry.id === "s");
    expect(story?.symbols.sort()).toEqual(["AMD", "NVDA"]);
    expect(story?.time).toBe(900);
  });
});

describe("parseFeed", () => {
  test("reads RSS items with CDATA, entities and a source", () => {
    const [entry] = parseFeed(`<rss><channel><item>
      <title><![CDATA[Acme &amp; Co. (NASDAQ: ACME) reports Q3]]></title>
      <link>https://wire.example/acme?x=1&amp;y=2</link>
      <pubDate>Wed, 26 Nov 2026 13:30:00 GMT</pubDate>
      <description>&lt;p&gt;Revenue up 12%&lt;/p&gt;</description>
      <source url="https://reuters.com">Reuters</source>
    </item></channel></rss>`);
    expect(entry.title).toBe("Acme & Co. (NASDAQ: ACME) reports Q3");
    expect(entry.link).toBe("https://wire.example/acme?x=1&y=2");
    expect(entry.time).toBe(Date.UTC(2026, 10, 26, 13, 30) / 1000);
    expect(entry.summary).toBe("Revenue up 12%");
    expect(entry.source).toBe("Reuters");
  });

  test("reads Atom entries and skips non-https links", () => {
    const entries = parseFeed(`<feed>
      <entry><title>One</title><link rel="alternate" href="https://a.example/1"/><updated>2026-11-26T10:00:00Z</updated></entry>
      <entry><title>Two</title><link href="http://insecure.example/2"/></entry>
    </feed>`);
    expect(entries.map((entry) => entry.link)).toEqual(["https://a.example/1"]);
  });
});
