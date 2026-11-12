import { describe, expect, test } from "bun:test";
import type { AgentUIMessage, KnowledgeHit } from "@repo/schemas";
import {
  CitationRegistry,
  citedNumbers,
  citedToolResult,
  partitionChunkIds,
  withCitations,
} from "./study-citations";

const id = (n: number) => n.toString(16).padStart(24, "0");

function hit(n: number): KnowledgeHit {
  return {
    chunkId: id(n),
    sourceKey: `note:${id(100)}`,
    sourceKind: "note",
    sourceId: id(100),
    title: "Linear algebra",
    headingPath: ["Eigenvalues"],
    body: `chunk ${n}`,
    contentHash: "h",
    score: 0,
  };
}

describe("citedNumbers", () => {
  test("reads single, grouped and adjacent brackets", () => {
    expect(citedNumbers("a [2] b [1, 3] c [4][5]")).toEqual([1, 2, 3, 4, 5]);
  });
  test("ignores zero, links and non-numeric brackets", () => {
    expect(citedNumbers("[0] [x] [link](u) [1a]")).toEqual([]);
  });
});

describe("partitionChunkIds", () => {
  const context = {
    retrieved: new Set([id(1)]),
    sourceKeyByChunk: new Map([
      [id(2), `note:${id(100)}`],
      [id(3), `note:${id(200)}`],
    ]),
    notebookKeys: new Set([`note:${id(100)}`]),
  };
  test("keeps retrieved and notebook chunks, drops the rest", () => {
    const result = partitionChunkIds(
      [id(1), id(2), id(3), id(4), "not-an-id", id(1)],
      context,
    );
    expect(result.kept).toEqual([id(1), id(2)]);
    expect(result.dropped).toEqual([id(3), id(4), "not-an-id"]);
  });
});

describe("CitationRegistry", () => {
  test("numbers hits once and cites only referenced ones", () => {
    const registry = new CitationRegistry();
    expect(registry.register(hit(1))).toBe(1);
    expect(registry.register(hit(2))).toBe(2);
    expect(registry.register(hit(1))).toBe(1);
    expect(
      registry.citationsFor("see [2] and [9]").map((c) => c.chunkId),
    ).toEqual([id(2)]);
  });

  test("a resumed message continues its numbering", () => {
    const first = new CitationRegistry();
    first.register(hit(1));
    const message: AgentUIMessage = {
      id: "m1",
      role: "assistant",
      parts: [
        { type: "text", text: "x [1]" },
        {
          type: "data-citations",
          id: "citations",
          data: first.citationsFor("[1]"),
        },
      ],
    };
    const resumed = CitationRegistry.fromHistory([message]);
    expect(resumed.register(hit(2))).toBe(2);
    expect(resumed.retrieved().has(id(1))).toBe(true);
  });
});

function searchMessage(
  messageId: string,
  hits: KnowledgeHit[],
  firstN: number,
): AgentUIMessage {
  return {
    id: messageId,
    role: "assistant",
    parts: [
      {
        type: "tool-search_notebook",
        toolCallId: `call-${messageId}`,
        state: "output-available",
        input: { query: "q" },
        output: {
          results: hits.map((h, index) =>
            citedToolResult(h, firstN + index, h.body),
          ),
        },
      },
    ],
  };
}

describe("CitationRegistry across turns", () => {
  test("an approval-pause resume resolves [1] from the search output alone", () => {
    const history = [searchMessage("a1", [hit(1)], 1)];
    const resumed = CitationRegistry.fromHistory(history);
    expect(resumed.citationsFor("see [1]").map((c) => c.chunkId)).toEqual([
      id(1),
    ]);
    expect(resumed.retrieved().has(id(1))).toBe(true);
  });

  test("a later search continues numbering and keeps a known chunk's number", () => {
    const history: AgentUIMessage[] = [
      searchMessage("a1", [hit(1), hit(2)], 1),
      { id: "u2", role: "user", parts: [{ type: "text", text: "more" }] },
    ];
    const registry = CitationRegistry.fromHistory(history);
    expect(registry.register(hit(3))).toBe(3);
    expect(registry.register(hit(2))).toBe(2);
    expect(registry.citationsFor("[1][3]").map((c) => c.chunkId)).toEqual([
      id(1),
      id(3),
    ]);
  });

  test("page labels and body survive the round trip", () => {
    const withPage: KnowledgeHit = { ...hit(1), page: { start: 3, end: 5 } };
    const registry = CitationRegistry.fromHistory([
      searchMessage("a1", [withPage], 1),
    ]);
    expect(registry.citationsFor("[1]")[0]).toMatchObject({
      page: { start: 3, end: 5 },
      body: "chunk 1",
    });
  });
});

describe("withCitations", () => {
  test("replaces the citations part with what the final text uses", () => {
    const registry = new CitationRegistry();
    registry.register(hit(1));
    registry.register(hit(2));
    const message: AgentUIMessage = {
      id: "m",
      role: "assistant",
      parts: [
        { type: "text", text: "Answer [2]." },
        { type: "data-citations", id: "citations", data: [] },
      ],
    };
    const [saved] = withCitations([message], registry);
    const parts = saved?.parts.filter((p) => p.type === "data-citations");
    expect(parts).toHaveLength(1);
    expect(
      parts?.[0]?.type === "data-citations" && parts[0].data[0]?.chunkId,
    ).toBe(id(2));
  });
  test("leaves a user-last list alone", () => {
    const user: AgentUIMessage = { id: "u", role: "user", parts: [] };
    expect(withCitations([user], new CitationRegistry())).toEqual([user]);
  });
});
