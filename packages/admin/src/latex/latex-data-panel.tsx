"use client";

import type {
  LatexDataPointCandidate,
  LatexDataPointSearchResponse,
  LatexReferenceSuggestion,
} from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { EmptyState } from "@repo/ui/empty-state";
import { ScrollArea } from "@repo/ui/scroll-area";
import { Spinner } from "@repo/ui/spinner";
import { Textarea } from "@repo/ui/textarea";
import { BookPlus, Check, ExternalLink, Search, TextQuote } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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

  // Prefill once; refilling whenever the field is empty made it impossible
  // to clear.
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || activeParagraph.trim().length < 3) return;
    prefilled.current = true;
    setQuery((current) => current || activeParagraph.trim().slice(0, 2_000));
  }, [activeParagraph]);

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
      <div className="flex min-w-0 flex-col gap-2 border-b p-3">
        <div className="flex min-w-0 gap-2">
          <Textarea
            name="data-point-query"
            aria-label="Data-point research question"
            autoComplete="off"
            value={query}
            className="min-h-16 min-w-0 flex-1 resize-none"
            placeholder="Metric, population, place, period"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void search();
              }
            }}
          />
          <Button
            variant="outline"
            size="icon"
            className="shrink-0"
            aria-label="Search verified data points"
            disabled={searching || query.trim().length < 3}
            onClick={() => void search()}
          >
            {searching ? <Spinner className="size-3.5" /> : <Search />}
          </Button>
        </div>
        {activeParagraph.trim() ? (
          <Button
            variant="ghost"
            size="xs"
            className="self-start text-muted-foreground"
            onClick={() => setQuery(activeParagraph.trim().slice(0, 2_000))}
          >
            <TextQuote /> Active paragraph
          </Button>
        ) : null}
      </div>

      <ScrollArea className="min-h-0 min-w-0 flex-1">
        <div className="flex min-w-0 flex-col divide-y divide-border/70 px-3">
          {result ? (
            <div className="flex flex-col gap-1 py-3 text-xs text-muted-foreground">
              <p className="line-clamp-2 break-words">
                <span className="text-accent-strong">
                  {result.intent.metric}
                </span>
                {result.intent.desiredUnit
                  ? ` · ${result.intent.desiredUnit}`
                  : ""}
              </p>
              <p className="tabular-nums">
                {result.inspectedPassages} passages · {result.candidates.length}{" "}
                verified
                {result.rejectedCandidates
                  ? ` · ${result.rejectedCandidates} rejected`
                  : ""}
              </p>
              {conflictingUnits.length > 0 ? (
                <p className="text-status-warning">
                  Conflicting estimates: {conflictingUnits.join(", ")}
                </p>
              ) : null}
            </div>
          ) : null}

          {(result?.candidates ?? []).map((candidate) => {
            const identity = candidateIdentity(candidate);
            const citationKey =
              acceptedKeys[identity] ?? candidate.reference.citationKey;
            const url = candidate.reference.url;
            return (
              <article
                key={candidate.id}
                className="flex min-w-0 flex-col gap-1.5 py-3"
              >
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-calistoga text-lg leading-tight tabular-nums text-accent-strong">
                      {candidate.value} {candidate.unit}
                    </p>
                    <h3
                      className="mt-0.5 line-clamp-2 break-words text-xs text-accent-strong"
                      title={candidate.reference.title}
                    >
                      {candidate.reference.title}
                    </h3>
                  </div>
                  <Badge variant="good" className="shrink-0">
                    Verified
                  </Badge>
                </div>
                {sourceLine(candidate) ? (
                  <p className="line-clamp-2 break-words text-xs text-muted-foreground">
                    {sourceLine(candidate)}
                  </p>
                ) : null}
                <blockquote className="min-w-0 border-l-2 pl-2 text-xs leading-5 text-muted-foreground">
                  <span className="line-clamp-5 break-words">
                    {candidate.supportingPassage}
                  </span>
                </blockquote>
                <div className="flex min-w-0 flex-wrap items-center gap-1 pt-0.5">
                  {citationKey ? (
                    <span className="flex min-w-0 items-center gap-1 px-1 text-xs text-status-good">
                      <Check className="size-3.5 shrink-0" />
                      <span className="truncate font-mono">{citationKey}</span>
                    </span>
                  ) : (
                    <Button
                      variant="outline"
                      size="xs"
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
                        <Spinner className="size-3" />
                      ) : (
                        <BookPlus />
                      )}
                      Add source
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => onInsertText(valueWithUnit(candidate))}
                  >
                    Insert value
                  </Button>
                  {citationKey ? (
                    <>
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => onInsertText(`\\cite{${citationKey}}`)}
                      >
                        Cite
                      </Button>
                      <Button
                        variant="outline"
                        size="xs"
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
                  {url ? (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="text-muted-foreground"
                      aria-label="Open evidence source"
                      onClick={() => platform.openExternal(url)}
                    >
                      <ExternalLink />
                    </Button>
                  ) : null}
                </div>
              </article>
            );
          })}

          {!searching && result && result.candidates.length === 0 ? (
            <EmptyState compact icon={<Search />} label="No verified values" />
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}
