"use client";

import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { EmptyState } from "@repo/ui/empty-state";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@repo/ui/sheet";
import { Skeleton } from "@repo/ui/skeleton";
import { FilterTabs, ToolbarSpacer } from "@repo/ui/toolbar";
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

const ALL_TYPES = "__all__";

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

  const types = [...new Set(suggestions.map((s) => s.type))];
  const visible = suggestions.filter((suggestion) =>
    selectedType ? suggestion.type === selectedType : true,
  );
  const busy = running || bulkAction !== null;

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="w-full gap-0 sm:max-w-lg">
        <SheetHeader className="h-11 flex-row items-center gap-2 border-b px-4 py-0 pr-12">
          <BrainCircuit className="size-4 text-muted-foreground" />
          <SheetTitle className="text-sm">Semantic</SheetTitle>
          <SheetDescription className="sr-only">
            Pending suggestions
          </SheetDescription>
        </SheetHeader>

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
          {types.length > 1 ? (
            <FilterTabs
              value={selectedType ?? ALL_TYPES}
              onChange={(value) =>
                setSelectedType(value === ALL_TYPES ? null : value)
              }
              options={[
                { value: ALL_TYPES, label: "All", count: suggestions.length },
                ...types.map((type) => ({
                  value: type,
                  label: (
                    <span className="capitalize">
                      {suggestionTypeLabel(type)}
                    </span>
                  ),
                  count: suggestions.filter((s) => s.type === type).length,
                })),
              ]}
            />
          ) : (
            <span className="text-xs tabular-nums text-muted-foreground">
              {suggestions.length} pending
            </span>
          )}
          <ToolbarSpacer />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void runSync()}
            disabled={busy}
          >
            {running ? <Loader2 className="animate-spin" /> : <RefreshCcw />}
            {running ? (stage ?? "Running") : "Sync"}
          </Button>
        </div>

        {visible.length > 0 && (
          <div className="flex shrink-0 items-center justify-end gap-1 border-b px-4 py-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void decideAll("dismiss")}
              disabled={busy}
            >
              {bulkAction === "dismiss" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <X />
              )}
              Dismiss {visible.length}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void decideAll("accept")}
              disabled={busy}
            >
              {bulkAction === "accept" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Check />
              )}
              Accept {visible.length}
            </Button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {loading ? (
            <div className="flex flex-col gap-4 p-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="flex flex-col gap-2">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-full" />
                </div>
              ))}
            </div>
          ) : visible.length === 0 ? (
            <EmptyState icon={<BrainCircuit />} label="No suggestions" />
          ) : (
            <div className="flex flex-col divide-y divide-border/70">
              {visible.map((suggestion) => (
                <div
                  key={suggestion._id}
                  className="flex flex-col gap-1.5 px-4 py-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                      {suggestionTypeLabel(suggestion.type)}
                    </span>
                    <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                      {Math.round(suggestion.confidence * 100)}%
                    </span>
                  </div>
                  {suggestion.proposedName && (
                    <div className="text-sm font-medium text-accent-strong">
                      {suggestion.proposedName}
                    </div>
                  )}
                  {suggestion.proposedTags?.length ? (
                    <div className="flex flex-wrap gap-1">
                      {suggestion.proposedTags.map((tag) => (
                        <Badge key={tag} variant="outline">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {suggestion.reason}
                  </p>
                  <div className="flex justify-end gap-1 pt-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void decide(suggestion, "dismiss")}
                      disabled={busy}
                    >
                      Dismiss
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void decide(suggestion, "accept")}
                      disabled={busy}
                    >
                      <Check />
                      Accept
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
