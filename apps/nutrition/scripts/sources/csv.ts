import { createReadStream } from "node:fs";

/**
 * Streams RFC 4180 CSV records: quoted fields may hold commas, doubled quotes
 * and newlines. Yields each record as an array of strings, header included.
 */
export async function* readCsv(
  path: string,
  delimiter = ",",
): AsyncGenerator<string[]> {
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let pendingQuote = false;

  for await (const chunk of createReadStream(path, {
    encoding: "utf8",
    highWaterMark: 1 << 20,
  })) {
    const text = chunk as string;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];

      if (inQuotes) {
        if (pendingQuote) {
          pendingQuote = false;
          if (char === '"') {
            field += '"';
            continue;
          }
          inQuotes = false;
        } else if (char === '"') {
          pendingQuote = true;
          continue;
        } else {
          field += char;
          continue;
        }
      }

      if (char === '"' && field === "") {
        inQuotes = true;
      } else if (char === delimiter) {
        record.push(field);
        field = "";
      } else if (char === "\n") {
        record.push(field.endsWith("\r") ? field.slice(0, -1) : field);
        yield record;
        record = [];
        field = "";
      } else {
        field += char;
      }
    }
  }

  if (pendingQuote) inQuotes = false;
  if (field !== "" || record.length > 0) {
    record.push(field);
    yield record;
  }
}

/** Yields records keyed by header name. */
export async function* readCsvObjects(
  path: string,
  delimiter = ",",
): AsyncGenerator<Record<string, string>> {
  let header: string[] | undefined;
  for await (const record of readCsv(path, delimiter)) {
    if (!header) {
      header = record.map((name) => name.replace(/^﻿/, "").trim());
      continue;
    }
    const row: Record<string, string> = {};
    for (let index = 0; index < header.length; index += 1) {
      row[header[index] as string] = record[index] ?? "";
    }
    yield row;
  }
}
