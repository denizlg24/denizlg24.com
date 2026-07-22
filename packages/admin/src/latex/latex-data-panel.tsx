"use client";

import type {
  LatexDataPointCandidate,
  LatexDataPointSearchResponse,
  LatexReferenceSuggestion,
} from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { ScrollArea } from "@repo/ui/scroll-area";
import { Textarea } from "@repo/ui/textarea";
import { BookPlus, Check, ExternalLink, Loader2, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";

function candidateIdentity(candidate: LatexDataPointCandidate): string {
  return (
    candidate.reference.paperId ??
    candidate.reference.openAlexId ??
    candidate.reference.doi ??
    candidate.id
  );
}

function latexText(value: string): string {
  return value.replace(/[&%$#_{}]/g, (match) => `\\${match}`);
}

function valueWithUnit(candidate: LatexDataPointCandidate): string {
  if (
    candidate.value
      .trim()
      .toLocaleLowerCase()
      .includes(candidate.unit.trim().toLocaleLowerCase())
  ) {
    return latexText(candidate.value);
  }
  const value = latexText(candidate.value);
  const unit = latexText(candidate.unit);
  return candidate.unit === "%" ? `${value}\\%` : `${value}~${unit}`;
}

function sourceLine(candidate: LatexDataPointCandidate): string {
  return [
    candidate.reference.year,
    candidate.reference.venue,
    candidate.reference.publisher,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function LatexDataPanel({
  projectId,
  activeParagraph,
  onAcceptReference,
  onInsertText,
}: {
  projectId: string;
  activeParagraph: string;
  onAcceptReference: (
    suggestion: LatexReferenceSuggestion,
  ) => Promise<{ citationKey: string }>;
  onInsertText: (value: string) => void;
}) {
  const { client, platform } = useAdmin();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<LatexDataPointSearchResponse | null>(
    null,
  );
  const [searching, setSearching] = useState(false);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [acceptedKeys, setAcceptedKeys] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!query && activeParagraph.trim().length >= 3) {
      setQuery(activeParagraph.trim().slice(0, 2_000));
    }
  }, [activeParagraph, query]);

  const conflictingUnits = useMemo(() => {
    const byUnit = new Map<string, Set<string>>();
    for (const candidate of result?.candidates ?? []) {
      const unit = candidate.unit.trim().toLocaleLowerCase();
      const values = byUnit.get(unit) ?? new Set<string>();
      values.add(candidate.value.trim().toLocaleLowerCase());
      byUnit.set(unit, values);
    }
    return [...byUnit.entries()]
      .filter(([, values]) => values.size > 1)
      .map(([unit]) => unit);
  }, [result]);

  const search = async () => {
    const value = query.trim();
    if (value.length < 3) return;
    setSearching(true);
    try {
      const response = await client.post<LatexDataPointSearchResponse>(
        `latex/projects/${projectId}/data-points`,
        { query: value.slice(0, 2_000), limit: 8 },
      );
      setResult(response);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Verified data-point search failed",
      );
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="min-w-0 space-y-2 border-b p-3">
        <div className="flex min-w-0 gap-2">
          <Textarea
            name="data-point-query"
            aria-label="Data-point research question"
            autoComplete="off"
            value={query}
            className="min-h-16 min-w-0 flex-1 resize-none text-xs"
            placeholder="Metric, population, place, and period…"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void search();
              }
            }}
          />
          <Button
            size="icon-sm"
            className="shrink-0"
            aria-label="Search verified data points"
            disabled={searching || query.trim().length < 3}
            onClick={() => void search()}
          >
            {searching ? <Loader2 className="animate-spin" /> : <Search />}
          </Button>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
          {activeParagraph.trim() ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={() => setQuery(activeParagraph.trim().slice(0, 2_000))}
            >
              Use active paragraph
            </Button>
          ) : null}
          <span>Exact passage, value, and unit must agree.</span>
        </div>
      </div>

      <ScrollArea className="min-h-0 min-w-0 flex-1">
        <div className="min-w-0 divide-y">
          {result ? (
            <div className="space-y-1.5 px-3 py-2 text-[10px] text-muted-foreground">
              <p className="line-clamp-2 break-words">
                <span className="font-medium text-foreground">Intent:</span>{" "}
                {result.intent.metric}
                {result.intent.desiredUnit
                  ? ` · ${result.intent.desiredUnit}`
                  : ""}
              </p>
              <p>
                Inspected {result.inspectedPassages} abstract passages ·{" "}
                {result.candidates.length} verified candidates
                {result.rejectedCandidates
                  ? ` · rejected ${result.rejectedCandidates}`
                  : ""}
              </p>
              {conflictingUnits.length > 0 ? (
                <p className="font-medium text-amber-700 dark:text-amber-400">
                  Conflicting estimates found for {conflictingUnits.join(", ")}
                  {"; compare their populations and methods."}
                </p>
              ) : null}
            </div>
          ) : null}

          {(result?.candidates ?? []).map((candidate) => {
            const identity = candidateIdentity(candidate);
            const citationKey =
              acceptedKeys[identity] ?? candidate.reference.citationKey;
            return (
              <article key={candidate.id} className="min-w-0 space-y-2 p-3">
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold tabular-nums">
                      {candidate.value} {candidate.unit}
                    </p>
                    <h3
                      className="mt-0.5 line-clamp-2 break-words text-[11px] font-medium"
                      title={candidate.reference.title}
                    >
                      {candidate.reference.title}
                    </h3>
                  </div>
                  <Badge variant="outline" className="shrink-0 text-[9px]">
                    Verified
                  </Badge>
                </div>
                {sourceLine(candidate) ? (
                  <p className="line-clamp-2 break-words text-[10px] text-muted-foreground">
                    {sourceLine(candidate)}
                  </p>
                ) : null}
                <blockquote className="min-w-0 border-l-2 pl-2 text-[10px] leading-4 text-muted-foreground">
                  <span className="line-clamp-5 break-words">
                    {candidate.supportingPassage}
                  </span>
                </blockquote>
                <div className="flex min-w-0 flex-wrap items-center gap-1">
                  {citationKey ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 min-w-0 text-[10px]"
                      disabled
                    >
                      <Check />
                      <span className="truncate">{citationKey}</span>
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      className="h-7 min-w-0 text-[10px]"
                      disabled={accepting === identity}
                      onClick={() => {
                        setAccepting(identity);
                        void onAcceptReference(candidate.reference)
                          .then(({ citationKey: accepted }) =>
                            setAcceptedKeys((current) => ({
                              ...current,
                              [identity]: accepted,
                            })),
                          )
                          .catch(() =>
                            toast.error("Failed to add evidence source"),
                          )
                          .finally(() => setAccepting(null));
                      }}
                    >
                      {accepting === identity ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <BookPlus />
                      )}
                      <span className="truncate">Add source</span>
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[10px]"
                    onClick={() => onInsertText(valueWithUnit(candidate))}
                  >
                    Insert value
                  </Button>
                  {citationKey ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-[10px]"
                        onClick={() => onInsertText(`\\cite{${citationKey}}`)}
                      >
                        Cite
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-[10px]"
                        onClick={() =>
                          onInsertText(
                            `${valueWithUnit(candidate)} & \\cite{${citationKey}} \\\\\n`,
                          )
                        }
                      >
                        Table row
                      </Button>
                    </>
                  ) : null}
                  {candidate.reference.url ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Open evidence source"
                      onClick={() =>
                        platform.openExternal(candidate.reference.url as string)
                      }
                    >
                      <ExternalLink />
                    </Button>
                  ) : null}
                </div>
              </article>
            );
          })}

          {!searching && result && result.candidates.length === 0 ? (
            <div className="px-6 py-12 text-center text-xs text-muted-foreground">
              No exact numerical evidence was found in the inspected abstracts.
              Try a more specific metric, population, or period.
            </div>
          ) : null}
          {!searching && !result ? (
            <div className="px-6 py-12 text-center text-xs text-muted-foreground">
              Search project references and OpenAlex for inspectable numerical
              evidence.
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}
