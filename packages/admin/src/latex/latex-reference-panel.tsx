"use client";

import type {
  LatexReferenceSearchResponse,
  LatexReferenceSuggestion,
} from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { EmptyState } from "@repo/ui/empty-state";
import { Input } from "@repo/ui/input";
import { ScrollArea } from "@repo/ui/scroll-area";
import { SectionLabel } from "@repo/ui/section";
import { Spinner } from "@repo/ui/spinner";
import { BookPlus, Check, ExternalLink, Search, TextQuote } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";

function authorLine(suggestion: LatexReferenceSuggestion): string {
  const names = suggestion.authors
    .slice(0, 3)
    .map(
      (author) =>
        author.literal ??
        [author.given, author.family].filter(Boolean).join(" "),
    );
  if (suggestion.authors.length > 3) names.push("et al.");
  return names.filter(Boolean).join(", ");
}

export function LatexReferencePanel({
  projectId,
  activeParagraph,
  onAccept,
  onInsertCitation,
}: {
  projectId: string;
  activeParagraph: string;
  onAccept: (
    suggestion: LatexReferenceSuggestion,
  ) => Promise<{ citationKey: string }>;
  onInsertCitation: (citationKey: string) => void;
}) {
  const { client, platform } = useAdmin();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<LatexReferenceSuggestion[]>(
    [],
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

  const search = async () => {
    const value = query.trim();
    if (value.length < 3) return;
    setSearching(true);
    try {
      const response = await client.post<LatexReferenceSearchResponse>(
        `latex/projects/${projectId}/references/search`,
        { query: value.slice(0, 2_000), limit: 20 },
      );
      setSuggestions(response.suggestions);
    } catch {
      toast.error("Reference search failed");
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 max-w-full flex-col overflow-hidden">
      <div className="flex min-w-0 flex-col gap-2 border-b p-3">
        <div className="flex min-w-0 gap-2">
          <Input
            value={query}
            className="min-w-0 flex-1"
            placeholder="Claim or question"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void search();
            }}
          />
          <Button
            variant="outline"
            size="icon"
            aria-label="Search references"
            disabled={searching}
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
      <ScrollArea className="min-h-0 w-full min-w-0 max-w-full flex-1">
        <div className="flex w-full min-w-0 max-w-full flex-col gap-2 overflow-hidden p-3">
          {suggestions.length > 0 ? (
            <SectionLabel count={suggestions.length}>Results</SectionLabel>
          ) : null}
          <div className="flex flex-col divide-y divide-border/70">
            {suggestions.map((suggestion) => {
              const id =
                suggestion.paperId ??
                suggestion.openAlexId ??
                suggestion.doi ??
                suggestion.title;
              const acceptedKey = acceptedKeys[id];
              const url = suggestion.url;
              return (
                <article
                  key={id}
                  className="flex w-full min-w-0 max-w-full flex-col gap-1.5 overflow-hidden py-3"
                >
                  <div className="flex min-w-0 items-start gap-2">
                    <h3
                      className="min-w-0 flex-1 text-sm leading-5 text-accent-strong"
                      title={suggestion.title}
                    >
                      {suggestion.title}
                    </h3>
                    <Badge
                      className="shrink-0"
                      variant={
                        suggestion.source === "papers" ? "info" : "secondary"
                      }
                    >
                      {suggestion.source === "papers" ? "Library" : "OpenAlex"}
                    </Badge>
                  </div>
                  <p className="line-clamp-2 break-words text-xs text-muted-foreground">
                    {[
                      authorLine(suggestion),
                      suggestion.year,
                      suggestion.venue,
                      suggestion.publisher,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <p className="min-w-0 break-words text-xs text-muted-foreground">
                    {suggestion.matchRationale}
                    {suggestion.citationCount !== null ? (
                      <span className="tabular-nums">
                        {" "}
                        · {suggestion.citationCount} cited
                      </span>
                    ) : null}
                    {suggestion.isOpenAccess ? " · open access" : ""}
                  </p>
                  <div className="flex min-w-0 flex-wrap items-center gap-1 pt-0.5">
                    {acceptedKey ? (
                      <>
                        <span className="flex min-w-0 items-center gap-1 px-1 text-xs text-status-good">
                          <Check className="size-3.5 shrink-0" />
                          <span className="truncate font-mono">
                            {acceptedKey}
                          </span>
                        </span>
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => onInsertCitation(acceptedKey)}
                        >
                          Cite
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="outline"
                        size="xs"
                        disabled={accepting === id}
                        onClick={() => {
                          setAccepting(id);
                          void onAccept(suggestion)
                            .then(({ citationKey }) =>
                              setAcceptedKeys((current) => ({
                                ...current,
                                [id]: citationKey,
                              })),
                            )
                            .catch(() => toast.error("Failed to add reference"))
                            .finally(() => setAccepting(null));
                        }}
                      >
                        {accepting === id ? (
                          <Spinner className="size-3" />
                        ) : (
                          <BookPlus />
                        )}
                        Add to .bib
                      </Button>
                    )}
                    {url ? (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="text-muted-foreground"
                        aria-label="Open source"
                        onClick={() => platform.openExternal(url)}
                      >
                        <ExternalLink />
                      </Button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
          {!searching && suggestions.length === 0 ? (
            <EmptyState compact icon={<Search />} label="No results" />
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}
