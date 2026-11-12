import {
  type AgentUIMessage,
  type KnowledgeHit,
  knowledgeHitSchema,
  type PageRange,
  type StudyCitation,
} from "@repo/schemas";
import { z } from "zod";
import { isAgentToolPart, messageText, toolPartName } from "./messages";

export const CITATIONS_PART_ID = "citations";

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const BRACKET_GROUP = /\[(\d+(?:\s*[,;]\s*\d+)*)\]/g;

export function toCitation(hit: KnowledgeHit, n: number): StudyCitation {
  return {
    n,
    chunkId: hit.chunkId,
    sourceKey: hit.sourceKey,
    sourceKind: hit.sourceKind,
    sourceId: hit.sourceId,
    title: hit.title,
    headingPath: hit.headingPath,
    ...(hit.page ? { page: hit.page } : {}),
    ...(hit.startMs !== undefined ? { startMs: hit.startMs } : {}),
    ...(hit.sourceStart !== undefined ? { sourceStart: hit.sourceStart } : {}),
    ...(hit.sourceEnd !== undefined ? { sourceEnd: hit.sourceEnd } : {}),
    body: hit.body,
  };
}

export function pageLabel(page: PageRange | undefined): string | undefined {
  if (!page) return undefined;
  return page.start === page.end
    ? `p. ${page.start}`
    : `pp. ${page.start}-${page.end}`;
}

function parsePageLabel(label: string | undefined): PageRange | undefined {
  const match = label?.match(/^pp?\. (\d+)(?:-(\d+))?$/);
  if (!match) return undefined;
  const start = Number.parseInt(match[1] ?? "", 10);
  const end = Number.parseInt(match[2] ?? match[1] ?? "", 10);
  return start >= 1 && end >= 1 ? { start, end } : undefined;
}

const toolResultSchema = knowledgeHitSchema
  .pick({
    chunkId: true,
    sourceKey: true,
    sourceKind: true,
    sourceId: true,
    title: true,
    headingPath: true,
    startMs: true,
    sourceStart: true,
    sourceEnd: true,
  })
  .extend({
    n: z.number().int().min(1),
    page: z.string().optional(),
    text: z.string(),
  });

const toolOutputSchema = z.union([
  z.object({ results: z.array(z.unknown()) }),
  z.object({ chunks: z.array(z.unknown()) }),
]);

/** The fields of a numbered chunk the model sees; enough to rebuild its citation from history. */
export function citedToolResult(
  hit: KnowledgeHit,
  n: number,
  text: string,
): z.input<typeof toolResultSchema> {
  return {
    n,
    chunkId: hit.chunkId,
    sourceKey: hit.sourceKey,
    sourceKind: hit.sourceKind,
    sourceId: hit.sourceId,
    title: hit.title,
    headingPath: hit.headingPath,
    ...(hit.page ? { page: pageLabel(hit.page) } : {}),
    ...(hit.startMs !== undefined ? { startMs: hit.startMs } : {}),
    ...(hit.sourceStart !== undefined ? { sourceStart: hit.sourceStart } : {}),
    ...(hit.sourceEnd !== undefined ? { sourceEnd: hit.sourceEnd } : {}),
    text,
  };
}

const NUMBERING_TOOLS: ReadonlySet<string> = new Set([
  "search_notebook",
  "read_source",
]);

function citationsInToolOutput(output: unknown): StudyCitation[] {
  const container = toolOutputSchema.safeParse(output);
  if (!container.success) return [];
  const items =
    "results" in container.data
      ? container.data.results
      : container.data.chunks;
  return items.flatMap((item) => {
    const parsed = toolResultSchema.safeParse(item);
    if (!parsed.success) return [];
    const { text, page, ...rest } = parsed.data;
    const range = parsePageLabel(page);
    return [{ ...rest, ...(range ? { page: range } : {}), body: text }];
  });
}

/** The numbers referenced as `[1]`, `[2, 3]` or `[1][4]` in an answer, ascending. */
export function citedNumbers(text: string): number[] {
  const found = new Set<number>();
  for (const match of text.matchAll(BRACKET_GROUP)) {
    for (const part of (match[1] ?? "").split(/[,;]/)) {
      const n = Number.parseInt(part.trim(), 10);
      if (n >= 1) found.add(n);
    }
  }
  return [...found].sort((a, b) => a - b);
}

/**
 * What an assistant message may cite. Numbering is per conversation: `[n]` is
 * the number a chunk got the first time any search or read returned it, and
 * new chunks continue from the highest. `allowed` is every chunk the
 * conversation has retrieved, which is what a generated card may name as its
 * source.
 */
export class CitationRegistry {
  private readonly numbered = new Map<number, StudyCitation>();
  private readonly numberByChunk = new Map<string, number>();
  private readonly allowed = new Set<string>();

  static fromHistory(history: readonly AgentUIMessage[]): CitationRegistry {
    const registry = new CitationRegistry();
    for (const message of history) {
      for (const part of message.parts) {
        if (part.type === "data-citations") {
          for (const citation of part.data) registry.restore(citation);
        } else if (
          isAgentToolPart(part) &&
          NUMBERING_TOOLS.has(toolPartName(part)) &&
          part.state === "output-available"
        ) {
          for (const citation of citationsInToolOutput(part.output)) {
            registry.restore(citation);
          }
        }
      }
    }
    return registry;
  }

  private restore(citation: StudyCitation): void {
    this.allowed.add(citation.chunkId);
    if (
      this.numbered.has(citation.n) ||
      this.numberByChunk.has(citation.chunkId)
    ) {
      return;
    }
    this.numbered.set(citation.n, citation);
    this.numberByChunk.set(citation.chunkId, citation.n);
  }

  register(hit: KnowledgeHit): number {
    const existing = this.numberByChunk.get(hit.chunkId);
    if (existing !== undefined) return existing;
    const n = Math.max(0, ...this.numbered.keys()) + 1;
    this.restore(toCitation(hit, n));
    return n;
  }

  retrieved(): ReadonlySet<string> {
    return this.allowed;
  }

  citationsFor(text: string): StudyCitation[] {
    return citedNumbers(text).flatMap((n) => {
      const citation = this.numbered.get(n);
      return citation ? [citation] : [];
    });
  }
}

export function partitionChunkIds(
  ids: readonly string[],
  context: {
    retrieved: ReadonlySet<string>;
    sourceKeyByChunk: ReadonlyMap<string, string>;
    notebookKeys: ReadonlySet<string>;
  },
): { kept: string[]; dropped: string[] } {
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const id of new Set(ids)) {
    const sourceKey = context.sourceKeyByChunk.get(id);
    const belongs =
      OBJECT_ID.test(id) &&
      (context.retrieved.has(id) ||
        (sourceKey !== undefined && context.notebookKeys.has(sourceKey)));
    (belongs ? kept : dropped).push(id);
  }
  return { kept, dropped };
}

export function isChunkId(value: string): boolean {
  return OBJECT_ID.test(value);
}

export function trimBody(body: string, max: number): string {
  return body.length <= max ? body : `${body.slice(0, max).trimEnd()}…`;
}

/** The last assistant message with the citations part for what its text references. */
export function withCitations(
  messages: readonly AgentUIMessage[],
  registry: CitationRegistry,
): AgentUIMessage[] {
  const last = messages.at(-1);
  if (last?.role !== "assistant") return [...messages];
  const citations = registry.citationsFor(messageText(last));
  const parts: AgentUIMessage["parts"] = last.parts.filter(
    (part) => part.type !== "data-citations",
  );
  if (citations.length > 0) {
    parts.push({
      type: "data-citations",
      id: CITATIONS_PART_ID,
      data: citations,
    });
  }
  return [...messages.slice(0, -1), { ...last, parts }];
}
