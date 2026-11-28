import { inflateRawSync } from "node:zlib";
import { XMLParser } from "fast-xml-parser";

export type Cell = string | number | null;
export type Sheet = { name: string; rows: Cell[][] };

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  attributeNamePrefix: "@",
  textNodeName: "#text",
  parseTagValue: false,
  isArray: (name) =>
    ["si", "r", "t", "row", "c", "sheet", "Relationship"].includes(name),
});

function zipEntries(buffer: Buffer): Map<string, Buffer> {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("Not a zip archive.");
  const count = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16);
  const entries = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50)
      throw new Error("Corrupt zip directory.");
    const method = buffer.readUInt16LE(cursor + 10);
    const compressed = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const local = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    const dataStart =
      local +
      30 +
      buffer.readUInt16LE(local + 26) +
      buffer.readUInt16LE(local + 28);
    const data = buffer.subarray(dataStart, dataStart + compressed);
    entries.set(name, method === 0 ? data : inflateRawSync(data));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

type XmlNode = Record<string, unknown>;
const asNode = (value: unknown): XmlNode =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as XmlNode)
    : {};
const asList = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : value === undefined ? [] : [value];

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  const node = asNode(value);
  if ("#text" in node) return textOf(node["#text"]);
  return "";
}

function sharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const root = asNode(asNode(parser.parse(xml)).sst);
  return asList(root.si).map((item) => {
    const node = asNode(item);
    if ("t" in node) return asList(node.t).map(textOf).join("");
    return asList(node.r)
      .map((run) => asList(asNode(run).t).map(textOf).join(""))
      .join("");
  });
}

function columnIndex(reference: string): number {
  let index = 0;
  for (const char of reference) {
    const code = char.charCodeAt(0);
    if (code < 65 || code > 90) break;
    index = index * 26 + (code - 64);
  }
  return index - 1;
}

function parseSheet(xml: string, strings: string[]): Cell[][] {
  const root = asNode(asNode(parser.parse(xml)).worksheet);
  const rows: Cell[][] = [];
  for (const rowItem of asList(asNode(root.sheetData).row)) {
    const row: Cell[] = [];
    for (const cellItem of asList(asNode(rowItem).c)) {
      const cell = asNode(cellItem);
      const reference = textOf(cell["@r"]);
      const type = textOf(cell["@t"]);
      const raw = textOf(cell.v);
      let value: Cell = null;
      if (type === "s") value = strings[Number(raw)] ?? null;
      else if (type === "inlineStr")
        value = asList(asNode(cell.is).t).map(textOf).join("");
      else if (type === "str" || type === "b" || type === "e")
        value = raw || null;
      else if (raw !== "") value = Number(raw);
      if (reference) row[columnIndex(reference)] = value;
      else row.push(value);
    }
    rows.push(Array.from(row, (cell) => cell ?? null));
  }
  return rows;
}

export function readWorkbook(buffer: Buffer): Sheet[] {
  const entries = zipEntries(buffer);
  const read = (name: string) =>
    entries
      .get(name)
      ?.toString("utf8")
      .replace(/^\uFEFF/, "");
  const workbook = read("xl/workbook.xml");
  const relationships = read("xl/_rels/workbook.xml.rels");
  if (!workbook || !relationships) throw new Error("Not a workbook.");
  const targets = new Map<string, string>();
  for (const rel of asList(
    asNode(asNode(parser.parse(relationships)).Relationships).Relationship,
  )) {
    const node = asNode(rel);
    const target = textOf(node["@Target"]);
    targets.set(
      textOf(node["@Id"]),
      target.startsWith("/") ? target.slice(1) : `xl/${target}`,
    );
  }
  const strings = sharedStrings(read("xl/sharedStrings.xml"));
  const sheets: Sheet[] = [];
  for (const item of asList(
    asNode(asNode(asNode(parser.parse(workbook)).workbook).sheets).sheet,
  )) {
    const node = asNode(item);
    const path = targets.get(textOf(node["@id"]));
    const xml = path ? read(path) : undefined;
    if (xml)
      sheets.push({
        name: textOf(node["@name"]),
        rows: parseSheet(xml, strings),
      });
  }
  return sheets;
}

/** Excel serial day (1900 system) to an ISO date. */
export function excelDate(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 20000 || serial > 80000) return null;
  return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000)
    .toISOString()
    .slice(0, 10);
}
