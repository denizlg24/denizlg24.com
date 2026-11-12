"use client";

import type { StudyCitation } from "@repo/schemas";
import {
  MessageResponse,
  type MessageResponseProps,
} from "@repo/ui/ai-elements/message";
import { createContext, useContext } from "react";
import { pageLabel, SOURCE_KIND_ICON } from "./study-format";

const CITE_PREFIX = "#cite-";

/**
 * Turns `[1]`, `[2, 3]` into hash links the markdown renderer hands to the
 * `a` override below. Fenced code, inline code and math are left alone so a
 * subscript like `x[1]` inside them survives.
 */
export function linkCitationMarkers(text: string): string {
  const protectedSpans =
    /(```[\s\S]*?(?:```|$)|`[^`\n]*`|\$\$[\s\S]*?\$\$|\$[^$\n]+\$)/g;
  return text
    .split(protectedSpans)
    .map((segment, index) =>
      index % 2 === 1
        ? segment
        : segment.replace(
            /\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\](?![(:[])/g,
            (_, list: string) =>
              list
                .split(",")
                .map((n) => `[${n.trim()}](${CITE_PREFIX}${n.trim()})`)
                .join(""),
          ),
    )
    .join("");
}

export function citationLabel(citation: StudyCitation): string {
  const path = [citation.title, ...citation.headingPath].join(" › ");
  const page = pageLabel(citation.page);
  return page ? `${path}, ${page}` : path;
}

interface CitationContextValue {
  citations: StudyCitation[];
  onOpen: (citation: StudyCitation) => void;
}

// Read through context rather than closed over by `components`: the renderer
// is memoised on its text, and citations arrive after the text has finished.
const CitationContext = createContext<CitationContextValue | null>(null);

function CitationMarker({ n }: { n: number }) {
  const context = useContext(CitationContext);
  const citation = context?.citations.find((entry) => entry.n === n);
  if (!citation || !context) {
    return (
      <sup className="px-px text-[10px] tabular-nums text-muted-foreground">
        {n}
      </sup>
    );
  }
  const label = citationLabel(citation);
  return (
    <sup className="px-px">
      <button
        type="button"
        title={label}
        aria-label={`Source ${n}: ${label}`}
        onClick={() => context.onOpen(citation)}
        className="rounded-sm px-0.5 text-[10px] font-medium tabular-nums text-accent-strong underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        {n}
      </button>
    </sup>
  );
}

const components: MessageResponseProps["components"] = {
  a: ({ href, children, node: _node, ...props }) => {
    if (href?.startsWith(CITE_PREFIX)) {
      const n = Number(href.slice(CITE_PREFIX.length));
      if (Number.isInteger(n) && n > 0) return <CitationMarker n={n} />;
    }
    return (
      <a href={href} target="_blank" rel="noreferrer" {...props}>
        {children}
      </a>
    );
  },
};

export function CitedText({
  text,
  streaming,
  citations,
  onOpen,
}: {
  text: string;
  streaming: boolean;
  citations: StudyCitation[];
  onOpen: (citation: StudyCitation) => void;
}) {
  return (
    <CitationContext.Provider value={{ citations, onOpen }}>
      <MessageResponse isAnimating={streaming} components={components}>
        {linkCitationMarkers(text)}
      </MessageResponse>
    </CitationContext.Provider>
  );
}

export function CitationList({
  citations,
  onOpen,
}: {
  citations: StudyCitation[];
  onOpen: (citation: StudyCitation) => void;
}) {
  if (citations.length === 0) return null;
  return (
    <ol className="flex flex-col border-t border-border/70 pt-2">
      {citations.map((citation) => (
        <li key={`${citation.chunkId}-${citation.n}`}>
          <button
            type="button"
            onClick={() => onOpen(citation)}
            className="-mx-1.5 flex w-[calc(100%+0.75rem)] min-w-0 items-baseline gap-2 rounded-md px-1.5 py-1 text-left text-xs transition-colors hover:bg-surface/70 focus-visible:bg-surface/70 focus-visible:outline-none"
          >
            <span className="w-4 shrink-0 text-right tabular-nums text-muted-foreground">
              {citation.n}
            </span>
            <span className="flex shrink-0 self-center text-muted-foreground [&_svg]:size-3.5">
              {SOURCE_KIND_ICON[citation.sourceKind]}
            </span>
            <span className="min-w-0 flex-1 truncate">
              <span className="text-accent-strong">{citation.title}</span>
              {citation.headingPath.length > 0 ? (
                <span className="text-muted-foreground">
                  {" › "}
                  {citation.headingPath.join(" › ")}
                </span>
              ) : null}
            </span>
            {citation.page ? (
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {pageLabel(citation.page)}
              </span>
            ) : null}
          </button>
        </li>
      ))}
    </ol>
  );
}
