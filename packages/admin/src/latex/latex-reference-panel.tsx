"use client";

import type {
  LatexReferenceSearchResponse,
  LatexReferenceSuggestion,
} from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { ScrollArea } from "@repo/ui/scroll-area";
import { BookPlus, Check, ExternalLink, Loader2, Search } from "lucide-react";
import { useEffect, useState } from "react";
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

  useEffect(() => {
    if (!query && activeParagraph.trim().length >= 3) {
      setQuery(activeParagraph.trim().slice(0, 2_000));
    }
  }, [activeParagraph, query]);

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
      <div className="min-w-0 space-y-2 border-b p-3">
        <div className="flex min-w-0 gap-2">
          <Input
            value={query}
            className="h-8 min-w-0 flex-1 text-xs"
            placeholder="Claim, paragraph, or research question…"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void search();
            }}
          />
          <Button
            size="sm"
            className="h-8 shrink-0"
            aria-label="Search references"
            disabled={searching}
            onClick={() => void search()}
          >
            {searching ? <Loader2 className="animate-spin" /> : <Search />}
          </Button>
        </div>
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
      </div>
      <ScrollArea className="min-h-0 w-full min-w-0 max-w-full flex-1">
        <div className="w-full min-w-0 max-w-full space-y-2 overflow-hidden p-3">
          {suggestions.length > 0 ? (
            <p className="text-[10px] text-muted-foreground">
              {suggestions.length} suggestions
            </p>
          ) : null}
          {suggestions.map((suggestion) => {
            const id =
              suggestion.paperId ??
              suggestion.openAlexId ??
              suggestion.doi ??
              suggestion.title;
            const acceptedKey = acceptedKeys[id];
            return (
              <article
                key={id}
                className="w-full min-w-0 max-w-full space-y-2 overflow-hidden rounded-lg border bg-background p-3"
              >
                <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <h3
                      className="truncate text-xs font-semibold leading-4"
                      title={suggestion.title}
                    >
                      {suggestion.title}
                    </h3>
                    <p className="mt-1 line-clamp-2 break-words text-[10px] text-muted-foreground">
                      {authorLine(suggestion)}
                      {suggestion.year ? ` · ${suggestion.year}` : ""}
                    </p>
                    {suggestion.venue || suggestion.publisher ? (
                      <p className="mt-0.5 line-clamp-2 break-words text-[10px] text-muted-foreground">
                        {suggestion.venue ? `Source: ${suggestion.venue}` : ""}
                        {suggestion.venue && suggestion.publisher ? " · " : ""}
                        {suggestion.publisher
                          ? `Publisher: ${suggestion.publisher}`
                          : ""}
                      </p>
                    ) : null}
                  </div>
                  <Badge
                    className="max-w-20 shrink-0 truncate"
                    variant={
                      suggestion.source === "papers" ? "default" : "secondary"
                    }
                  >
                    {suggestion.source === "papers" ? "Library" : "OpenAlex"}
                  </Badge>
                </div>
                <p className="min-w-0 break-words text-[10px] text-muted-foreground">
                  {suggestion.matchRationale}
                  {suggestion.citationCount !== null
                    ? ` · ${suggestion.citationCount} citations`
                    : ""}
                  {suggestion.isOpenAccess ? " · open access" : ""}
                </p>
                <div className="flex min-w-0 flex-wrap items-center gap-1">
                  {acceptedKey ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 min-w-0 max-w-full text-[10px]"
                        disabled
                      >
                        <Check className="shrink-0" />
                        <span className="truncate">Added as {acceptedKey}</span>
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 min-w-0 max-w-full text-[10px]"
                        onClick={() => onInsertCitation(acceptedKey)}
                      >
                        <span className="truncate">Insert citation</span>
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      className="h-7 min-w-0 max-w-full text-[10px]"
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
                        <Loader2 className="shrink-0 animate-spin" />
                      ) : (
                        <BookPlus className="shrink-0" />
                      )}
                      <span className="truncate">Add to bibliography</span>
                    </Button>
                  )}
                  {suggestion.url ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Open source"
                      onClick={() =>
                        platform.openExternal(suggestion.url as string)
                      }
                    >
                      <ExternalLink />
                    </Button>
                  ) : null}
                </div>
              </article>
            );
          })}
          {!searching && suggestions.length === 0 ? (
            <div className="py-12 text-center text-xs text-muted-foreground">
              Search your Papers library and OpenAlex together.
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}
