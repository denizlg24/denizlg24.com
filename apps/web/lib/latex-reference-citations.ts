import type {
  ILatexProjectRecord,
  LatexReferenceSuggestion,
} from "@repo/schemas";
import { normalizeDoi } from "@/lib/paper-citations";

export function normalizedReferenceTitle(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export interface ProjectCitationIndex {
  citationKeys: Set<string>;
  dois: Set<string>;
  openAlexIds: Set<string>;
  arxivIds: Set<string>;
  titles: Set<string>;
}

function withoutLatexComments(content: string): string {
  return content
    .split("\n")
    .map((line) => {
      for (let index = 0; index < line.length; index += 1) {
        if (line[index] !== "%") continue;
        let backslashes = 0;
        for (
          let cursor = index - 1;
          cursor >= 0 && line[cursor] === "\\";
          cursor -= 1
        ) {
          backslashes += 1;
        }
        if (backslashes % 2 === 0) return line.slice(0, index);
      }
      return line;
    })
    .join("\n");
}

export function projectCitationIndex(
  project: ILatexProjectRecord["project"],
): ProjectCitationIndex {
  const citationKeys = new Set<string>();
  const bibliography = new Map<string, string>();
  for (const entry of project.entries) {
    if (entry.kind !== "file" || entry.encoding !== "utf8") continue;
    if (entry.path.toLowerCase().endsWith(".bib")) {
      const starts = [
        ...entry.content.matchAll(/@[A-Za-z]+\s*\{\s*([^,\s]+)\s*,/g),
      ];
      for (let index = 0; index < starts.length; index += 1) {
        const match = starts[index];
        const key = match?.[1]?.trim().toLowerCase();
        if (!key) continue;
        const from = match.index ?? 0;
        const to = starts[index + 1]?.index ?? entry.content.length;
        bibliography.set(key, entry.content.slice(from, to));
      }
      continue;
    }
    for (const match of withoutLatexComments(entry.content).matchAll(
      /\\(?:[A-Za-z]*cite[A-Za-z]*|nocite)\*?(?:\s*\[[^\]]*\]){0,2}\s*\{([^}]*)\}/g,
    )) {
      for (const key of (match[1] ?? "").split(",")) {
        const normalized = key.trim().toLowerCase();
        if (normalized && normalized !== "*") citationKeys.add(normalized);
      }
    }
  }

  const dois = new Set<string>();
  const openAlexIds = new Set<string>();
  const arxivIds = new Set<string>();
  const titles = new Set<string>();
  for (const key of citationKeys) {
    const entry = bibliography.get(key);
    if (!entry) continue;
    for (const match of entry.matchAll(/10\.\d{4,9}\/[^\s,}"']+/gi)) {
      const doi = normalizeDoi(match[0]);
      if (doi) dois.add(doi);
    }
    for (const match of entry.matchAll(/\bW\d+\b/gi)) {
      openAlexIds.add(match[0].toLowerCase());
    }
    const arxiv = entry.match(/\beprint\s*=\s*(?:\{|"|')?([^,}\s"']+)/i)?.[1];
    if (arxiv) arxivIds.add(arxiv.toLowerCase().replace(/v\d+$/i, ""));
    const title = entry.match(/\btitle\s*=\s*\{([^\n]*)\}\s*,?/i)?.[1];
    if (title) {
      titles.add(normalizedReferenceTitle(title.replace(/[{}]/g, "")));
    }
  }
  return { citationKeys, dois, openAlexIds, arxivIds, titles };
}

export function isAlreadyCited(
  suggestion: LatexReferenceSuggestion,
  index: ProjectCitationIndex,
): boolean {
  if (
    suggestion.citationKey &&
    index.citationKeys.has(suggestion.citationKey.toLowerCase())
  ) {
    return true;
  }
  const doi = suggestion.doi ? normalizeDoi(suggestion.doi) : undefined;
  if (doi && index.dois.has(doi)) return true;
  if (
    suggestion.openAlexId &&
    index.openAlexIds.has(suggestion.openAlexId.toLowerCase())
  ) {
    return true;
  }
  if (
    suggestion.arxivId &&
    index.arxivIds.has(suggestion.arxivId.toLowerCase().replace(/v\d+$/i, ""))
  ) {
    return true;
  }
  return index.titles.has(normalizedReferenceTitle(suggestion.title));
}
