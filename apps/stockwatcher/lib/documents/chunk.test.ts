import assert from "node:assert/strict";
import { test } from "node:test";
import { chunkPages } from "./chunk";

const options = { target: 300, max: 400 };

test("short page becomes one chunk with its page number", () => {
  const chunks = chunkPages([{ page: 3, text: "Revenue grew 12%." }], options);
  assert.deepEqual(chunks, [{ seq: 0, page: 3, content: "Revenue grew 12%." }]);
});

test("chunks never span pages and seq is continuous", () => {
  const chunks = chunkPages(
    [
      { page: 1, text: "First page." },
      { page: 2, text: "Second page." },
    ],
    options,
  );
  assert.deepEqual(
    chunks.map((chunk) => [chunk.seq, chunk.page]),
    [
      [0, 1],
      [1, 2],
    ],
  );
});

test("paragraphs are packed up to the target and never exceed max", () => {
  const paragraph = "Margins expanded on mix. ".repeat(8).trim();
  const text = Array.from({ length: 12 }, () => paragraph).join("\n\n");
  const chunks = chunkPages([{ page: 1, text }], options);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(chunk.content.length <= options.max);
  assert.equal(chunks.map((chunk) => chunk.content).join("\n\n"), text);
});

test("a single oversized paragraph is split on sentence boundaries", () => {
  const sentence = "The company guided full-year revenue higher. ";
  const text = sentence.repeat(40).trim();
  const chunks = chunkPages([{ page: null, text }], options);
  assert.ok(chunks.length > 3);
  for (const chunk of chunks) {
    assert.ok(chunk.content.length <= options.max);
    assert.ok(chunk.content.endsWith("."));
  }
  assert.equal(chunks.map((chunk) => chunk.content).join(" "), text);
});

test("text without any whitespace is hard-split at max without losing characters", () => {
  const text = "x".repeat(1000);
  const chunks = chunkPages([{ page: 1, text }], options);
  assert.ok(chunks.every((chunk) => chunk.content.length <= options.max));
  assert.equal(chunks.map((chunk) => chunk.content).join(""), text);
});

test("empty and whitespace-only pages produce no chunks", () => {
  assert.deepEqual(chunkPages([{ page: 1, text: "  \n\n " }], options), []);
  assert.deepEqual(chunkPages([], options), []);
});

test("csv chunks repeat the header row", () => {
  const rows = Array.from({ length: 60 }, (_, i) => `AAPL,${i},${i * 2.5}`);
  const text = ["symbol,qty,price", ...rows].join("\n");
  const chunks = chunkPages([{ page: null, text }], {
    ...options,
    repeatFirstLine: true,
  });
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(chunk.content.startsWith("symbol,qty,price\n"));
    assert.ok(chunk.content.length <= options.max);
  }
  const body = chunks.flatMap((chunk) => chunk.content.split("\n").slice(1));
  assert.deepEqual(body, rows);
});

test("header-only csv still yields a chunk", () => {
  const chunks = chunkPages([{ page: null, text: "a,b,c" }], {
    ...options,
    repeatFirstLine: true,
  });
  assert.deepEqual(
    chunks.map((chunk) => chunk.content),
    ["a,b,c"],
  );
});

test("an oversized first line is not repeated into every chunk", () => {
  const header = "h".repeat(5000);
  const rows = Array.from({ length: 200 }, (_, i) => `row ${i},value`).join(
    "\n",
  );
  const chunks = chunkPages([{ page: null, text: `${header}\n${rows}` }], {
    ...options,
    repeatFirstLine: true,
  });
  const stored = chunks.reduce((sum, chunk) => sum + chunk.content.length, 0);
  assert.ok(stored < 5000 + rows.length + 1000);
  assert.ok(chunks.every((chunk) => chunk.content.length <= options.max));
});
