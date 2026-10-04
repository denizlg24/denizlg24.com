import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readCsv } from "./csv";

const collect = async (text: string) => {
  const path = join(tmpdir(), `csv-${crypto.randomUUID()}.csv`);
  await Bun.write(path, text);
  const records: string[][] = [];
  for await (const record of readCsv(path)) records.push(record);
  return records;
};

describe("readCsv", () => {
  test("handles quoted commas, doubled quotes and embedded newlines", async () => {
    expect(
      await collect('a,b,c\r\n1,"x, y","say ""hi"""\n2,"multi\nline",\n'),
    ).toEqual([
      ["a", "b", "c"],
      ["1", "x, y", 'say "hi"'],
      ["2", "multi\nline", ""],
    ]);
  });

  test("keeps a final record without a trailing newline", async () => {
    expect(await collect("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});
