"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Archive, Brain, Loader2, Play } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PaginatedDataTable } from "@/components/ui/paginated-data-table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUserSettings } from "@/context/user-context";
import { denizApi } from "@/lib/api-wrapper";
import type { IEmailTriage, TriageCategory } from "@/lib/data-types";
import { CategoryBadge } from "./_components/category-badge";
import { TriageLoadingSkeleton } from "./_components/triage-loading-skeleton";
import { TriageSheet } from "./_components/triage-sheet";

type TriageFilter = TriageCategory | "archived";

const FILTERS: { value: TriageFilter; label: string }[] = [
  { value: "action-needed", label: "Action Needed" },
  { value: "purchases", label: "Purchases" },
  { value: "scheduled", label: "Scheduled" },
  { value: "fyi", label: "FYI" },
  { value: "newsletter", label: "Newsletters" },
  { value: "promo", label: "Promo" },
  { value: "spam", label: "Spam" },
  { value: "archived", label: "Archived" },
];

function isTriageFilter(value: string): value is TriageFilter {
  return FILTERS.some((filter) => filter.value === value);
}

function getTriageEndpoint(filter: TriageFilter): string {
  if (filter === "archived") {
    return "triage?status=archived";
  }

  return `triage?status=open&category=${filter}`;
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

export default function TriagePage() {
  const { settings, loading: loadingSettings } = useUserSettings();
  const api = useMemo(() => {
    if (loadingSettings) return null;
    return new denizApi(settings.apiKey);
  }, [settings, loadingSettings]);

  const [items, setItems] = useState<IEmailTriage[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<TriageFilter>("action-needed");
  const [running, setRunning] = useState(false);
  const [archivingAll, setArchivingAll] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    const endpoint = getTriageEndpoint(filter);
    const res = await api.GET<{ items: IEmailTriage[] }>({ endpoint });
    if ("code" in res) {
      toast.error("Failed to load triage");
    } else {
      setItems(res.items);
    }
    setLoading(false);
  }, [api, filter]);

  useEffect(() => {
    void fetchItems();
  }, [fetchItems]);

  const handleRun = async () => {
    if (!api) return;
    setRunning(true);
    const res = await api.POST<{
      stats: {
        scanned: number;
        prefilteredSpam: number;
        fullTriaged: number;
      };
    }>({ endpoint: "triage/run", body: {} });
    setRunning(false);
    if ("code" in res) {
      toast.error("Triage run failed");
      return;
    }
    toast.success(
      `Scanned ${res.stats.scanned} · ${res.stats.fullTriaged} triaged · ${res.stats.prefilteredSpam} spam`,
    );
    await fetchItems();
  };

  const activeFilterLabel =
    FILTERS.find((entry) => entry.value === filter)?.label ?? "Items";

  const handleArchiveAll = async () => {
    if (!api || filter === "archived") return;

    setArchivingAll(true);
    setSelectedId(null);

    const res = await api.PATCH<{
      ok: boolean;
      modifiedCount: number;
      error?: string;
    }>({
      endpoint: "triage/archive",
      body: { category: filter },
    });

    setArchivingAll(false);

    if ("code" in res || res.ok === false) {
      toast.error(
        "error" in res && typeof res.error === "string"
          ? res.error
          : "message" in res
            ? res.message
            : "Failed to archive items",
      );
      return;
    }

    toast.success(
      res.modifiedCount === 0
        ? `No ${activeFilterLabel.toLowerCase()} items to archive`
        : `Archived ${res.modifiedCount} ${activeFilterLabel.toLowerCase()} item${res.modifiedCount === 1 ? "" : "s"}`,
    );

    await fetchItems();
  };

  const columns = useMemo<ColumnDef<IEmailTriage>[]>(
    () => [
      {
        id: "subject",
        header: "Subject",
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="text-xs font-medium truncate max-w-xs">
              {row.original.email?.subject ?? "(no subject)"}
            </span>
            <span className="text-[10px] text-muted-foreground truncate max-w-xs">
              {row.original.email?.from
                .map((f) => f.name ?? f.address)
                .join(", ")}
            </span>
          </div>
        ),
      },
      {
        id: "category",
        header: "Category",
        cell: ({ row }) => <CategoryBadge category={row.original.category} />,
      },
      {
        id: "suggestions",
        header: "Suggestions",
        cell: ({ row }) => {
          const t = row.original.suggestedTasks.length;
          const e = row.original.suggestedEvents.length;
          if (t + e === 0)
            return <span className="text-xs text-muted-foreground">—</span>;
          return (
            <span className="text-xs tabular-nums">
              {t > 0 && `${t}t`}
              {t > 0 && e > 0 && " · "}
              {e > 0 && `${e}e`}
            </span>
          );
        },
      },
      {
        id: "confidence",
        header: "Confidence",
        cell: ({ row }) => (
          <span className="text-xs tabular-nums">
            {(row.original.confidence * 100).toFixed(0)}%
          </span>
        ),
      },
      {
        id: "triagedAt",
        header: "Triaged",
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatRelative(row.original.triagedAt)}
          </span>
        ),
      },
    ],
    [],
  );

  if (loadingSettings) {
    return <TriageLoadingSkeleton />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
      <div className="flex items-center gap-2 px-4 border-b h-12 shrink-0">
        <Brain className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold flex-1">Triage</span>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 text-xs"
          onClick={handleRun}
          disabled={running || !api}
        >
          {running ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Play className="size-3.5" />
          )}
          Run now
        </Button>
      </div>

      <div className="px-4 flex flex-1 min-h-0 flex-col gap-4 overflow-hidden pt-3 pb-8">
        <Tabs
          value={filter}
          onValueChange={(value) => {
            if (isTriageFilter(value) && value !== filter) {
              setSelectedId(null);
              setFilter(value);
            }
          }}
        >
          <TabsList variant="line">
            {FILTERS.map((f) => (
              <TabsTrigger key={f.value} value={f.value}>
                {f.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {filter !== "archived" && (
          <div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-xs"
              onClick={handleArchiveAll}
              disabled={loading || archivingAll || items.length === 0}
            >
              {archivingAll ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Archive className="size-3.5" />
              )}
              Archive all in {activeFilterLabel}
            </Button>
          </div>
        )}

        <div className="min-h-0 flex-1">
          {loading ? (
            <TriageLoadingSkeleton contentOnly />
          ) : (
            <PaginatedDataTable
              columns={columns}
              data={items}
              emptyMessage="No triage items"
              onRowClick={(item) => setSelectedId(item._id)}
            />
          )}
        </div>
      </div>

      {api && (
        <TriageSheet
          api={api}
          triageId={selectedId}
          open={!!selectedId}
          onOpenChange={(open) => !open && setSelectedId(null)}
          onSuggestionUpdated={() => fetchItems()}
        />
      )}
    </div>
  );
}
