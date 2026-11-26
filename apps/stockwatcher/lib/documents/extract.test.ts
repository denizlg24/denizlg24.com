import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateRawSync } from "node:zlib";
import {
  detectKind,
  ExtractError,
  extractDocument,
  htmlToText,
  normalizeText,
} from "./extract";
import { documentLimits } from "./types";

const bytes = (text: string) => new TextEncoder().encode(text);

function pdf(pages: string[]) {
  const objects: string[] = [];
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ");
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((text, i) => {
    const stream = text
      ? `BT /F1 12 Tf 72 700 Td (${text}) Tj ET`
      : "0 0 100 100 re f";
    objects[4 + i * 2] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${5 + i * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`;
    objects[5 + i * 2] =
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i++)
    out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return bytes(out);
}

function zip(name: string, content: string) {
  const data = deflateRawSync(bytes(content));
  const nameBytes = bytes(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(0, 42);
  const body = Buffer.concat([local, nameBytes, data]);
  const directory = Buffer.concat([central, nameBytes]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(body.length, 16);
  return new Uint8Array(Buffer.concat([body, directory, end]));
}

test("pdf text is extracted per page", async () => {
  const result = await extractDocument(
    "memo.pdf",
    pdf([
      "Alpha revenue grew strongly in the quarter",
      "Beta margins compressed on input costs",
    ]),
  );
  assert.equal(result.kind, "pdf");
  assert.equal(result.pageCount, 2);
  assert.deepEqual(
    result.pages.map((page) => page.page),
    [1, 2],
  );
  assert.match(result.pages[0].text, /Alpha revenue/);
  assert.match(result.pages[1].text, /Beta margins/);
  assert.deepEqual(result.warnings, []);
});

test("pdf without a text layer is rejected as scanned", async () => {
  await assert.rejects(
    extractDocument("scan.pdf", pdf(["", "", ""])),
    (error) =>
      error instanceof ExtractError &&
      /no readable text layer/.test(error.message) &&
      /OCR/.test(error.message),
  );
});

test("pdf with some empty pages warns", async () => {
  const result = await extractDocument(
    "mixed.pdf",
    pdf(["Alpha revenue grew strongly in the quarter", ""]),
  );
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /1 of 2 pages/);
});

test("corrupt pdf is a clean error", async () => {
  await assert.rejects(
    extractDocument("bad.pdf", bytes("%PDF-1.4\nthis is not a pdf")),
    ExtractError,
  );
});

test("kind follows content for pdfs and the extension for text", () => {
  assert.equal(detectKind("renamed.txt", bytes("%PDF-1.7 ...")), "pdf");
  assert.equal(detectKind("a.MD", bytes("# hi")), "markdown");
  assert.equal(detectKind("a.csv", bytes("a,b")), "csv");
  assert.equal(detectKind("a.htm", bytes("<p>")), "html");
  assert.throws(() => detectKind("a.pdf", bytes("hello")), ExtractError);
  assert.throws(() => detectKind("a.exe", bytes("MZ")), ExtractError);
  assert.throws(
    () => detectKind("a.zip", bytes("PK\u0003\u0004")),
    ExtractError,
  );
});

test("plain text is normalized and keeps paragraphs", async () => {
  const result = await extractDocument(
    "n.txt",
    bytes("﻿Line one  \r\n\r\n\r\n\r\nLine\ttwo\u0000"),
  );
  assert.equal(result.pages[0].text, "Line one\n\nLine two");
  assert.equal(result.pageCount, null);
});

test("legacy single-byte encodings fall back to windows-1252", async () => {
  const result = await extractDocument(
    "n.txt",
    new Uint8Array([0x43, 0x61, 0x66, 0xe9]),
  );
  assert.equal(result.pages[0].text, "Café");
});

test("html drops scripts and styles and keeps block structure", async () => {
  const html = `<html><head><title>x</title><style>p{}</style></head><body>
    <script>alert(1)</script><h1>Q3 &amp; outlook</h1><p>Sales&nbsp;rose &#8364;5m</p><table><tr><td>A</td><td>B</td></tr></table></body></html>`;
  const text = htmlToText(html);
  assert.doesNotMatch(text, /alert|p\{\}|<h1>/);
  const normalized = normalizeText(text);
  assert.match(normalized, /Q3 & outlook\n\nSales rose €5m/);
  assert.match(normalized, /A B/);
});

test("docx paragraphs and entities are extracted", async () => {
  const xml =
    "<w:document><w:body><w:p><w:r><w:t>Thesis &amp; risks</w:t></w:r></w:p><w:p><w:r><w:t>Second</w:t></w:r><w:tab/><w:r><w:t>para</w:t></w:r></w:p></w:body></w:document>";
  const result = await extractDocument(
    "memo.docx",
    zip("word/document.xml", xml),
  );
  assert.equal(result.kind, "docx");
  assert.equal(result.pages[0].text, "Thesis & risks\n\nSecond para");
});

test("docx without a body part is rejected", async () => {
  await assert.rejects(
    extractDocument("memo.docx", zip("other.xml", "<a/>")),
    /No document body/,
  );
});

test("empty and whitespace-only files are rejected", async () => {
  await assert.rejects(extractDocument("a.txt", new Uint8Array()), /empty/);
  await assert.rejects(extractDocument("a.txt", bytes("  \n\n ")), /No text/);
});

test("oversized text is truncated with a warning", async () => {
  const line = "word ".repeat(200);
  const text = Array.from(
    { length: Math.ceil(documentLimits.textChars / line.length) + 50 },
    () => line,
  ).join("\n\n");
  const result = await extractDocument("big.txt", bytes(text));
  const length = result.pages.reduce((sum, page) => sum + page.text.length, 0);
  assert.equal(length, documentLimits.textChars);
  assert.match(result.warnings[0], /truncated/);
});

test("markup stripping is linear on unclosed tags, comments and script bodies", () => {
  const size = 2 * 1024 * 1024;
  const inputs = [
    "<".repeat(size),
    "<a".repeat(size / 2),
    "<!--".repeat(size / 4),
    "<script>".repeat(size / 8),
    "<x ".repeat(size / 3),
  ];
  const started = performance.now();
  for (const input of inputs) htmlToText(input);
  assert.ok(performance.now() - started < 2000);
});
