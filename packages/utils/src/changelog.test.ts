import { describe, expect, it } from "bun:test";

import { compareVersions, parseChangelog, parseInline } from "./changelog";

describe("parseChangelog", () => {
  it("reads releases, groups, lists and paragraphs", () => {
    const releases = parseChangelog(`# Changelog

Everything that shipped.

## 0.0.10 — 2026-10-05

Search, rebuilt.

### Fixed
- Results show as you type
- A food opens at once,
  even the first time

### Added
- **What's new** in Settings

## 0.0.9 (2026-10-04)
- Rebuilt food catalogue
`);

    expect(releases).toEqual([
      {
        version: "0.0.10",
        date: "2026-10-05",
        sections: [
          {
            title: null,
            blocks: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Search, rebuilt." }],
              },
            ],
          },
          {
            title: "Fixed",
            blocks: [
              {
                type: "list",
                items: [
                  [{ type: "text", text: "Results show as you type" }],
                  [
                    {
                      type: "text",
                      text: "A food opens at once, even the first time",
                    },
                  ],
                ],
              },
            ],
          },
          {
            title: "Added",
            blocks: [
              {
                type: "list",
                items: [
                  [
                    { type: "strong", text: "What's new" },
                    { type: "text", text: " in Settings" },
                  ],
                ],
              },
            ],
          },
        ],
      },
      {
        version: "0.0.9",
        date: "2026-10-04",
        sections: [
          {
            title: null,
            blocks: [
              {
                type: "list",
                items: [[{ type: "text", text: "Rebuilt food catalogue" }]],
              },
            ],
          },
        ],
      },
    ]);
  });

  it("accepts undated and v-prefixed releases", () => {
    expect(parseChangelog("## Unreleased\n- soon")[0]).toMatchObject({
      version: "Unreleased",
      date: null,
    });
    expect(parseChangelog("## [v1.2.0] - 2026-01-02\n- x")[0]).toMatchObject({
      version: "1.2.0",
      date: "2026-01-02",
    });
  });

  it("drops empty groups and ignores the preamble", () => {
    expect(parseChangelog("intro\n## 1.0.0\n### Empty\n")).toEqual([
      { version: "1.0.0", date: null, sections: [] },
    ]);
  });
});

describe("parseInline", () => {
  it("reads strong, code and links and keeps the rest literal", () => {
    expect(
      parseInline("Use `q` on **search**, see [docs](https://x.dev) *as is*"),
    ).toEqual([
      { type: "text", text: "Use " },
      { type: "code", text: "q" },
      { type: "text", text: " on " },
      { type: "strong", text: "search" },
      { type: "text", text: ", see " },
      { type: "link", text: "docs", href: "https://x.dev" },
      { type: "text", text: " *as is*" },
    ]);
  });
});

describe("compareVersions", () => {
  it("orders numerically and puts unnumbered versions last", () => {
    expect(compareVersions("0.0.10", "0.0.9")).toBe(1);
    expect(compareVersions("0.0.9", "0.0.9")).toBe(0);
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
    expect(compareVersions("0.1.0", "Unreleased")).toBe(-1);
  });
});
