import type { LatexFileEntry, LatexProject } from "./types";

export interface LatexProseRange {
  from: number;
  to: number;
  text: string;
}

export interface LatexProseMap {
  /** Same UTF-16 length as the source. Non-prose is replaced with spaces. */
  masked: string;
  ranges: LatexProseRange[];
}

const OPAQUE_COMMANDS = new Set([
  "cite",
  "citep",
  "citet",
  "autocite",
  "parencite",
  "textcite",
  "ref",
  "eqref",
  "pageref",
  "label",
  "url",
  "includegraphics",
  "input",
  "include",
  "bibliography",
  "bibliographystyle",
  "begin",
  "end",
]);

function isEscaped(source: string, index: number): boolean {
  let slashes = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && source[cursor] === "\\";
    cursor -= 1
  ) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

function maskRange(chars: string[], source: string, from: number, to: number) {
  for (let index = from; index < to; index += 1) {
    if (source[index] !== "\n" && source[index] !== "\r") chars[index] = " ";
  }
}

function balancedEnd(
  source: string,
  start: number,
  open: "{" | "[",
  close: "}" | "]",
): number {
  if (source[start] !== open) return start;
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === open && !isEscaped(source, index)) depth += 1;
    if (source[index] === close && !isEscaped(source, index)) depth -= 1;
    if (depth === 0) return index + 1;
  }
  return source.length;
}

function mathEnd(source: string, start: number): number {
  if (source.startsWith("$$", start)) {
    const end = source.indexOf("$$", start + 2);
    return end < 0 ? source.length : end + 2;
  }
  if (source[start] === "$") {
    for (let index = start + 1; index < source.length; index += 1) {
      if (source[index] === "$" && !isEscaped(source, index)) return index + 1;
    }
    return source.length;
  }
  const close = source.startsWith("\\(", start) ? "\\)" : "\\]";
  const end = source.indexOf(close, start + 2);
  return end < 0 ? source.length : end + 2;
}

export function mapLatexProse(source: string): LatexProseMap {
  const chars = source.split("");
  let index = 0;
  while (index < source.length) {
    if (source[index] === "%" && !isEscaped(source, index)) {
      const end = source.indexOf("\n", index);
      const to = end < 0 ? source.length : end;
      maskRange(chars, source, index, to);
      index = to;
      continue;
    }
    if (
      (source[index] === "$" && !isEscaped(source, index)) ||
      source.startsWith("\\(", index) ||
      source.startsWith("\\[", index)
    ) {
      const end = mathEnd(source, index);
      maskRange(chars, source, index, end);
      index = end;
      continue;
    }
    if (source[index] === "\\") {
      const commandStart = index;
      index += 1;
      if (!/[A-Za-z@]/.test(source[index] ?? "")) {
        maskRange(
          chars,
          source,
          commandStart,
          Math.min(source.length, index + 1),
        );
        index += 1;
        continue;
      }
      while (/[A-Za-z@]/.test(source[index] ?? "")) index += 1;
      const command = source.slice(commandStart + 1, index);
      if (source[index] === "*") index += 1;
      maskRange(chars, source, commandStart, index);
      while (/\s/.test(source[index] ?? "") && source[index] !== "\n")
        index += 1;
      while (source[index] === "[") {
        const end = balancedEnd(source, index, "[", "]");
        maskRange(chars, source, index, end);
        index = end;
        while (/\s/.test(source[index] ?? "") && source[index] !== "\n")
          index += 1;
      }
      if (command === "href" && source[index] === "{") {
        const end = balancedEnd(source, index, "{", "}");
        maskRange(chars, source, index, end);
        index = end;
        continue;
      }
      if (OPAQUE_COMMANDS.has(command) && source[index] === "{") {
        const end = balancedEnd(source, index, "{", "}");
        maskRange(chars, source, index, end);
        index = end;
        continue;
      }
      continue;
    }
    if (source[index] === "{" || source[index] === "}") {
      maskRange(chars, source, index, index + 1);
    }
    index += 1;
  }

  const masked = chars.join("");
  const ranges: LatexProseRange[] = [];
  const expression = /[^\s][^\n\r]*?[^\s]|[^\s]/g;
  for (const match of masked.matchAll(expression)) {
    const from = match.index ?? 0;
    ranges.push({ from, to: from + match[0].length, text: match[0] });
  }
  return { masked, ranges };
}

export interface LatexProjectOutline {
  headings: Array<{
    level: string;
    title: string;
    file: string;
    offset: number;
  }>;
  labels: string[];
  definitions: string[];
  bibliographyKeys: string[];
  files: Array<{ path: string; encoding: "utf8" | "base64"; size: number }>;
}

export interface LatexContextPack {
  file: string;
  revision: number;
  cursor: number;
  prefix: string;
  suffix: string;
  paragraph: string;
  section: string;
  outline: LatexProjectOutline;
  relatedChunks: Array<{ file: string; text: string }>;
  personalPreferences: Array<{ text: string; trust: "untrusted" }>;
}

function utf8Files(project: LatexProject): LatexFileEntry[] {
  return project.entries.filter(
    (entry): entry is LatexFileEntry =>
      entry.kind === "file" && entry.encoding === "utf8",
  );
}

export function buildLatexProjectOutline(
  project: LatexProject,
): LatexProjectOutline {
  const headings: LatexProjectOutline["headings"] = [];
  const labels = new Set<string>();
  const definitions = new Set<string>();
  const bibliographyKeys = new Set<string>();
  for (const file of utf8Files(project)) {
    for (const match of file.content.matchAll(
      /\\(part|chapter|section|subsection|subsubsection)\*?\{([^}]*)\}/g,
    )) {
      headings.push({
        level: match[1] ?? "section",
        title: match[2]?.trim() ?? "",
        file: file.path,
        offset: match.index ?? 0,
      });
    }
    for (const match of file.content.matchAll(/\\label\{([^}]+)\}/g)) {
      if (match[1]) labels.add(match[1]);
    }
    for (const match of file.content.matchAll(
      /\\(?:newcommand|renewcommand|def)\s*\{?\\([A-Za-z@]+)/g,
    )) {
      if (match[1]) definitions.add(match[1]);
    }
    if (file.path.toLowerCase().endsWith(".bib")) {
      for (const match of file.content.matchAll(
        /@[A-Za-z]+\s*\{\s*([^,\s]+)/g,
      )) {
        if (match[1]) bibliographyKeys.add(match[1]);
      }
    }
  }
  return {
    headings,
    labels: [...labels],
    definitions: [...definitions],
    bibliographyKeys: [...bibliographyKeys],
    files: project.entries.map((entry) => ({
      path: entry.path,
      encoding: entry.kind === "file" ? entry.encoding : "utf8",
      size:
        entry.kind === "file"
          ? new TextEncoder().encode(entry.content).length
          : 0,
    })),
  };
}

function paragraphAt(source: string, cursor: number): string {
  const before = source.lastIndexOf("\n\n", Math.max(0, cursor - 1));
  const after = source.indexOf("\n\n", cursor);
  return source.slice(
    before < 0 ? 0 : before + 2,
    after < 0 ? source.length : after,
  );
}

function sectionAt(source: string, cursor: number, limit: number): string {
  const heading =
    /\\(?:part|chapter|section|subsection|subsubsection)\*?\{[^}]*\}/g;
  let from = 0;
  let next = source.length;
  for (const match of source.matchAll(heading)) {
    const offset = match.index ?? 0;
    if (offset <= cursor) from = offset;
    else {
      next = offset;
      break;
    }
  }
  const section = source.slice(from, next);
  return section.length <= limit ? section : section.slice(0, limit);
}

function queryTerms(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .match(/[\p{L}\p{N}]{4,}/gu)
      ?.filter(
        (term) => !new Set(["that", "this", "with", "from", "have"]).has(term),
      ) ?? [],
  );
}

export function buildLatexContextPack(options: {
  project: LatexProject;
  revision: number;
  filePath: string;
  cursor: number;
  personalPreferences?: string[];
  maxPrefixChars?: number;
  maxSuffixChars?: number;
  maxSectionChars?: number;
  maxRelatedChunks?: number;
}): LatexContextPack {
  const file = utf8Files(options.project).find(
    (candidate) => candidate.path === options.filePath,
  );
  if (!file) throw new Error("Active UTF-8 file not found");
  const cursor = Math.max(0, Math.min(options.cursor, file.content.length));
  const paragraph = paragraphAt(file.content, cursor);
  const terms = queryTerms(paragraph);
  const candidates: Array<{ file: string; text: string; score: number }> = [];
  for (const candidate of utf8Files(options.project)) {
    if (candidate.id === file.id) continue;
    for (const text of candidate.content.split(/\n\s*\n/)) {
      if (!text.trim()) continue;
      const words = queryTerms(text);
      let score = 0;
      for (const term of terms) if (words.has(term)) score += 1;
      if (score > 0)
        candidates.push({
          file: candidate.path,
          text: text.slice(0, 1_200),
          score,
        });
    }
  }
  candidates.sort((left, right) => right.score - left.score);
  const maxPrefix = options.maxPrefixChars ?? 1_200;
  const maxSuffix = options.maxSuffixChars ?? 800;
  return {
    file: file.path,
    revision: options.revision,
    cursor,
    prefix: file.content.slice(Math.max(0, cursor - maxPrefix), cursor),
    suffix: file.content.slice(cursor, cursor + maxSuffix),
    paragraph,
    section: sectionAt(file.content, cursor, options.maxSectionChars ?? 4_000),
    outline: buildLatexProjectOutline(options.project),
    relatedChunks: candidates
      .slice(0, options.maxRelatedChunks ?? 3)
      .map(({ file: candidateFile, text }) => ({ file: candidateFile, text })),
    personalPreferences: (options.personalPreferences ?? [])
      .slice(0, 5)
      .map((text) => ({ text: text.slice(0, 500), trust: "untrusted" })),
  };
}
