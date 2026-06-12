"use client";

import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { Label } from "@repo/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { BrainCircuit, Check, Loader2, RefreshCcw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { denizApi } from "@/lib/api-wrapper";
import type { ISemanticSuggestion } from "@/lib/data-types";
import { runSemanticSync } from "@/lib/semantic/sync";

interface Props {
  api: denizApi;
  onClose: () => void;
  onChanged: () => void;
}

function isApiError<T>(value: T | { code: number; message: string }): value is {
  code: number;
  message: string;
} {
  return Boolean(value && typeof value === "object" && "code" in value);
}

function suggestionTypeLabel(type: ISemanticSuggestion["type"]) {
  return type.replace(/-/g, " ");
}

export function SemanticPanel({ api, onClose, onChanged }: Props) {
  const [suggestions, setSuggestions] = useState<ISemanticSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [bulkAction, setBulkAction] = useState<"accept" | "dismiss" | null>(
    null,
  );
  const [selectedType, setSelectedType] = useState<string | null>(null);

  const loadSuggestions = useCallback(async () => {
    setLoading(true);
    const result = await api.GET<{ suggestions: ISemanticSuggestion[] }>({
      endpoint: "semantic/suggestions?status=pending",
    });
    setLoading(false);

    if (isApiError(result)) {
      toast.error(result.message);
      return;
    }
    setSuggestions(result.suggestions);
  }, [api]);

  useEffect(() => {
    void loadSuggestions();
  }, [loadSuggestions]);

  const runSync = async ({ force = false }: { force?: boolean } = {}) => {
    setRunning(true);
    setStage("Starting");
    try {
      const result = await runSemanticSync({
        api,
        force,
        onProgress: (progress) => setStage(progress.stage),
      });
      toast.success(
        force
          ? `Keyword migration complete: ${result.embeddedCount} notes, ${result.suggestionCount} suggestions`
          : `Semantic run complete: ${result.embeddedCount} notes, ${result.suggestionCount} suggestions`,
      );
      await loadSuggestions();
      onChanged();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Semantic run failed",
      );
    } finally {
      setRunning(false);
      setStage(null);
    }
  };

  const decide = async (
    suggestion: ISemanticSuggestion,
    action: "accept" | "dismiss",
    options: { refresh?: boolean } = {},
  ) => {
    const result = await api.POST<{ suggestion: ISemanticSuggestion }>({
      endpoint: `semantic/suggestions/${suggestion._id}/${action}`,
      body: {},
    });

    if (isApiError(result)) {
      toast.error(result.message);
      return;
    }

    setSuggestions((current) =>
      current.filter((candidate) => candidate._id !== suggestion._id),
    );
    if (options.refresh !== false) onChanged();
    return true;
  };

  const decideAll = async (action: "accept" | "dismiss") => {
    const filteredSuggestions = suggestions.filter((s) =>
      selectedType ? s.type === selectedType : true,
    );
    if (filteredSuggestions.length === 0) return;

    setBulkAction(action);
    let completed = 0;
    try {
      for (const suggestion of filteredSuggestions) {
        const ok = await decide(suggestion, action, { refresh: false });
        if (ok) completed += 1;
      }
      toast.success(
        `${action === "accept" ? "Accepted" : "Dismissed"} ${completed} suggestions`,
      );
      await loadSuggestions();
      onChanged();
    } finally {
      setSelectedType(null);
      setBulkAction(null);
    }
  };

  return (
    <div className="absolute inset-y-0 right-0 z-20 flex w-full max-w-md flex-col border-l bg-background shadow-xl">
      <div className="flex h-12 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2">
          <BrainCircuit className="size-4" />
          <h2 className="text-sm font-medium">Semantic Notes</h2>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2"
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </div>

      <div className="flex flex-col gap-2 border-b p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Classification
          </span>
          <span className="text-[11px] text-muted-foreground">Server LLM</span>
        </div>
        <Button
          size="sm"
          className="h-7 w-full justify-center"
          onClick={() => void runSync()}
          disabled={running || bulkAction !== null}
        >
          {running ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCcw className="size-3.5" />
          )}
          {running ? (stage ?? "Running") : "Run sync"}
        </Button>
        {suggestions.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 justify-center text-xs"
              onClick={() => void decideAll("dismiss")}
              disabled={running || bulkAction !== null}
            >
              {bulkAction === "dismiss" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <X className="size-3.5" />
              )}
              Dismiss all
            </Button>
            <Button
              size="sm"
              className="h-7 justify-center text-xs"
              onClick={() => void decideAll("accept")}
              disabled={running || bulkAction !== null}
            >
              {bulkAction === "accept" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
              Accept all
            </Button>
            {[...new Set(suggestions.map((s) => s.type))].length > 1 && (
              <div className="col-span-2 w-full flex flex-col items-start gap-1">
                <Label className="shrink-0 text-left text-[10px] text-muted-foreground w-fit">
                  Suggestion Type:
                </Label>

                <Select
                  onValueChange={(value) => setSelectedType(value || null)}
                  value={selectedType ?? ""}
                >
                  <SelectTrigger className="w-full grow capitalize">
                    <SelectValue placeholder="All Types" />
                  </SelectTrigger>
                  <SelectContent className="w-full" position="popper">
                    {[...new Set(suggestions.map((s) => s.type))].map(
                      (type) => (
                        <SelectItem
                          className="capitalize"
                          key={type}
                          value={type}
                        >
                          {suggestionTypeLabel(type)}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : suggestions.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <BrainCircuit className="size-6 text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground">
              No pending suggestions.
            </p>
            <p className="text-[10px] text-muted-foreground/70">
              Run a sync to surface new groups, tags, and links.
            </p>
          </div>
        ) : (
          <div className="divide-y">
            {suggestions
              .filter((suggestion) =>
                selectedType ? suggestion.type === selectedType : true,
              )
              .map((suggestion) => (
                <div key={suggestion._id} className="p-3">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <Badge
                      variant="outline"
                      className="h-5 rounded-md px-1.5 text-[10px] uppercase tracking-wide"
                    >
                      {suggestionTypeLabel(suggestion.type)}
                    </Badge>
                    <span className="text-[10px] tabular-nums text-muted-foreground">
                      {Math.round(suggestion.confidence * 100)}% match
                    </span>
                  </div>
                  {suggestion.proposedName && (
                    <div className="mb-1 text-sm font-medium">
                      {suggestion.proposedName}
                    </div>
                  )}
                  {suggestion.proposedTags?.length ? (
                    <div className="mb-2 flex flex-wrap gap-1">
                      {suggestion.proposedTags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
                    {suggestion.reason}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 flex-1 text-xs"
                      onClick={() => void decide(suggestion, "dismiss")}
                      disabled={bulkAction !== null}
                    >
                      <X className="size-3.5" />
                      Dismiss
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 flex-1 text-xs"
                      onClick={() => void decide(suggestion, "accept")}
                      disabled={bulkAction !== null}
                    >
                      <Check className="size-3.5" />
                      Accept
                    </Button>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
