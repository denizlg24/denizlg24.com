import { readdir } from "node:fs/promises";
import { join } from "node:path";

import type { ResearchReader } from "../types";

/**
 * Every module in this folder exports `reader`. Loaded by file name so a
 * reader can be added without touching a registry.
 */
export const loadReaders = async (
  only?: string[],
): Promise<ResearchReader[]> => {
  const files = (await readdir(import.meta.dir)).filter(
    (file) =>
      file.endsWith(".ts") && file !== "index.ts" && !file.endsWith(".test.ts"),
  );
  const readers: ResearchReader[] = [];
  for (const file of files.sort()) {
    const module = (await import(join(import.meta.dir, file))) as {
      reader?: ResearchReader;
    };
    if (!module.reader) throw new Error(`${file} does not export \`reader\``);
    if (!only || only.includes(module.reader.source))
      readers.push(module.reader);
  }
  return readers;
};
