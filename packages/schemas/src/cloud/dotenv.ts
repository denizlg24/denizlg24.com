import { deployEnvKeySchema } from "./deploy-env";

export interface ParsedDotenvEntry {
  key: string;
  value: string;
  /** 1-indexed, so the editor can point at the offending line in a paste. */
  line: number;
}

export interface DotenvParseResult {
  entries: ParsedDotenvEntry[];
  /** Parsed cleanly but not a usable variable name. Reported, never dropped silently. */
  invalidKeys: ParsedDotenvEntry[];
  /** 1-indexed lines that carried something other than a comment and could not be read. */
  skippedLines: number[];
  /** Keys that appeared more than once. The last occurrence is the one kept. */
  duplicateKeys: string[];
}

const WHITESPACE = new Set([" ", "\t"]);

/**
 * Parses the contents of a `.env` file the way the editor's paste box needs
 * it: tolerant of anything a real file carries, and explicit about what it
 * could not read rather than quietly dropping lines.
 *
 * Deliberately does not expand `$VAR` references. A pasted file is a set of
 * literals headed for encrypted storage; resolving one against the pasting
 * machine's shell would write a value the owner never saw, and resolving it
 * against the rest of the paste would silently disagree with what the same
 * file does under `source`.
 */
export function parseDotenv(input: string): DotenvParseResult {
  const text = input.replace(/\r\n?/g, "\n");
  const entries: ParsedDotenvEntry[] = [];
  const invalidKeys: ParsedDotenvEntry[] = [];
  const skippedLines: number[] = [];
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  let index = 0;
  let line = 1;

  const skipToLineEnd = (): void => {
    while (index < text.length && text[index] !== "\n") index += 1;
  };

  while (index < text.length) {
    const char = text[index];
    if (char === "\n") {
      index += 1;
      line += 1;
      continue;
    }
    if (char !== undefined && WHITESPACE.has(char)) {
      index += 1;
      continue;
    }
    if (char === "#") {
      skipToLineEnd();
      continue;
    }

    const statementLine = line;
    let rawKey = "";
    while (index < text.length && text[index] !== "=" && text[index] !== "\n") {
      rawKey += text[index];
      index += 1;
    }

    if (index >= text.length || text[index] === "\n") {
      // No `=` on the line at all: a stray word, a YAML fragment, a fenced
      // block marker from a copy-paste out of documentation.
      if (rawKey.trim()) skippedLines.push(statementLine);
      continue;
    }
    index += 1; // the `=`

    const key = rawKey
      .trim()
      .replace(/^export\s+/, "")
      .trim();

    while (index < text.length) {
      const next = text[index];
      if (next === undefined || !WHITESPACE.has(next)) break;
      index += 1;
    }

    const quote = text[index];
    let value = "";
    let terminated = true;

    if (quote === '"' || quote === "'") {
      index += 1;
      terminated = false;
      while (index < text.length) {
        const current = text[index];
        if (current === "\\" && quote === '"') {
          const escaped = text[index + 1];
          if (escaped === undefined) break;
          value += UNESCAPED[escaped] ?? `\\${escaped}`;
          index += 2;
          continue;
        }
        if (current === quote) {
          index += 1;
          terminated = true;
          break;
        }
        if (current === "\n") line += 1;
        value += current;
        index += 1;
      }
      // Anything after the closing quote on that line is a comment or noise.
      skipToLineEnd();
    } else {
      while (index < text.length && text[index] !== "\n") {
        value += text[index];
        index += 1;
      }
      value = stripTrailingComment(value).trim();
    }

    if (!terminated) {
      skippedLines.push(statementLine);
      continue;
    }

    const entry: ParsedDotenvEntry = { key, value, line: statementLine };
    if (!deployEnvKeySchema.safeParse(key).success) {
      invalidKeys.push(entry);
      continue;
    }
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
    entries.push(entry);
  }

  // Last occurrence wins, matching how a shell sourcing the same file behaves.
  const deduped = new Map(entries.map((entry) => [entry.key, entry]));

  return {
    entries: [...deduped.values()],
    invalidKeys,
    skippedLines,
    duplicateKeys: [...duplicates],
  };
}

const UNESCAPED: Record<string, string> = {
  n: "\n",
  r: "\r",
  t: "\t",
  "\\": "\\",
  '"': '"',
  "'": "'",
  "\n": "",
};

/**
 * Only a `#` with whitespace in front of it starts a comment. Without that
 * rule every URL with a fragment and every password containing a hash loses
 * its tail.
 */
function stripTrailingComment(value: string): string {
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] !== "#") continue;
    const previous = value[i - 1];
    if (i === 0 || (previous !== undefined && WHITESPACE.has(previous))) {
      return value.slice(0, i);
    }
  }
  return value;
}
