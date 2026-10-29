"use client";

import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { ConfirmDialog } from "@repo/ui/confirm-button";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@repo/ui/dropdown-menu";
import { EmptyState } from "@repo/ui/empty-state";
import { FormDialog, FormField, FormGrid } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import { List, ListRow } from "@repo/ui/list";
import { Page, PageBody, PageToolbar } from "@repo/ui/page";
import { Skeleton } from "@repo/ui/skeleton";
import { Stat, StatGroup } from "@repo/ui/stat";
import { Textarea } from "@repo/ui/textarea";
import {
  FilterTabs,
  RowActions,
  SearchField,
  ToolbarSpacer,
} from "@repo/ui/toolbar";
import { cn } from "@repo/ui/utils";
import { Download, FileUp, Plus, RefreshCw, Sheet, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { DashboardPageHeader } from "@/components/navigation/dashboard-page-header";
import { useUserSettings } from "@/context/user-context";
import { denizApi } from "@/lib/api-wrapper";
import type { ISpreadsheet } from "@/lib/data-types";
import { pickFile } from "@/lib/platform-fs";
import { downloadSpreadsheet } from "./_components/download";

type SortKey = "updated" | "title" | "size";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "updated", label: "Updated" },
  { value: "title", label: "Title" },
  { value: "size", label: "Size" },
];

function formatRelativeDate(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMins = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function parseTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function SheetsSkeleton() {
  return (
    <>
      <StatGroup>
        {["Workbooks", "Sheets", "Storage"].map((label) => (
          <div key={label} className="flex flex-col gap-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-6 w-12" />
          </div>
        ))}
      </StatGroup>
      <div className="flex flex-col">
        {["w-48", "w-36", "w-56", "w-40"].map((width) => (
          <div key={width} className="flex h-12 items-center gap-3">
            <Skeleton className="size-4" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className={cn("h-3.5", width)} />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
    </>
  );
}

export default function SpreadsheetsPage() {
  const router = useRouter();
  const { loading: loadingSettings } = useUserSettings();

  const api = useMemo(
    () => (loadingSettings ? null : new denizApi()),
    [loadingSettings],
  );

  const [sheets, setSheets] = useState<ISpreadsheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("updated");
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createTags, setCreateTags] = useState("");
  const [importing, setImporting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ISpreadsheet | null>(null);

  const fetchSheets = useCallback(async () => {
    if (!api) return;
    const result = await api.GET<{ spreadsheets: ISpreadsheet[] }>({
      endpoint: "spreadsheets",
    });
    if ("code" in result) toast.error("Failed to load spreadsheets");
    else setSheets(result.spreadsheets);
    setLoading(false);
  }, [api]);

  useEffect(() => {
    fetchSheets();
  }, [fetchSheets]);

  const totals = useMemo(
    () => ({
      count: sheets.length,
      sheets: sheets.reduce((a, s) => a + (s.sheetCount || 0), 0),
      size: sheets.reduce((a, s) => a + (s.sizeBytes || 0), 0),
    }),
    [sheets],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? sheets.filter(
          (s) =>
            s.title.toLowerCase().includes(q) ||
            s.description?.toLowerCase().includes(q) ||
            s.tags.some((tag) => tag.toLowerCase().includes(q)),
        )
      : sheets;
    return [...filtered].sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title);
      if (sort === "size") return b.sizeBytes - a.sizeBytes;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [sheets, query, sort]);

  const resetCreate = () => {
    setCreateTitle("");
    setCreateDescription("");
    setCreateTags("");
  };

  const handleCreate = async () => {
    if (!api || !createTitle.trim()) return;
    setCreating(true);
    const result = await api.POST<{ spreadsheet: ISpreadsheet }>({
      endpoint: "spreadsheets",
      body: {
        title: createTitle.trim(),
        description: createDescription.trim() || undefined,
        tags: parseTags(createTags),
      },
    });
    setCreating(false);
    if ("code" in result) {
      toast.error("Failed to create spreadsheet");
      return;
    }
    setCreateOpen(false);
    resetCreate();
    router.push(`/dashboard/spreadsheets/editor?id=${result.spreadsheet._id}`);
  };

  const handleImport = async () => {
    if (!api) return;
    try {
      const picked = await pickFile({
        accept: ".xlsx,.xls,.csv",
        filters: [{ name: "Spreadsheets", extensions: ["xlsx", "xls", "csv"] }],
      });
      if (!picked) return;

      setImporting(true);
      const file = new File(
        [new Blob([picked.data], { type: "application/octet-stream" })],
        picked.name,
      );
      const formData = new FormData();
      formData.append("file", file);

      const result = await api.UPLOAD<{ spreadsheet: ISpreadsheet }>({
        endpoint: "spreadsheets/import",
        formData,
      });
      if ("code" in result) {
        toast.error("Failed to import spreadsheet");
        return;
      }
      router.push(
        `/dashboard/spreadsheets/editor?id=${result.spreadsheet._id}`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = async (target: ISpreadsheet) => {
    if (!api) return;
    setSheets((prev) => prev.filter((s) => s._id !== target._id));
    setDeleteTarget(null);
    const result = await api.DELETE<{ message: string }>({
      endpoint: `spreadsheets/${target._id}`,
    });
    if ("code" in result) {
      toast.error("Failed to delete spreadsheet");
      fetchSheets();
    }
  };

  const showSkeleton = loadingSettings || loading;

  return (
    <Page>
      <DashboardPageHeader icon={<Sheet />} title="Spreadsheets">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh"
          disabled={!api || refreshing}
          onClick={async () => {
            setRefreshing(true);
            await fetchSheets();
            setRefreshing(false);
          }}
        >
          <RefreshCw className={cn(refreshing && "animate-spin")} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleImport}
          disabled={!api || importing}
        >
          <FileUp className={cn(importing && "animate-pulse")} />
          Import
        </Button>
        <Button size="sm" onClick={() => setCreateOpen(true)} disabled={!api}>
          <Plus /> New
        </Button>
      </DashboardPageHeader>

      {sheets.length > 0 && (
        <PageToolbar>
          <SearchField value={query} onChange={setQuery} />
          <ToolbarSpacer />
          <FilterTabs value={sort} onChange={setSort} options={SORT_OPTIONS} />
        </PageToolbar>
      )}

      <PageBody>
        {showSkeleton ? (
          <SheetsSkeleton />
        ) : sheets.length === 0 ? (
          <EmptyState
            icon={<Sheet />}
            label="No spreadsheets"
            action={
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus /> New
                </Button>
                <Button size="sm" variant="outline" onClick={handleImport}>
                  <FileUp /> Import
                </Button>
              </div>
            }
          />
        ) : (
          <>
            <StatGroup>
              <Stat label="Workbooks" value={totals.count} />
              <Stat label="Sheets" value={totals.sheets} />
              <Stat label="Storage" value={formatBytes(totals.size)} />
            </StatGroup>
            {visible.length === 0 ? (
              <EmptyState compact label="0 results" />
            ) : (
              <List>
                {visible.map((sheet) => (
                  <ListRow
                    key={sheet._id}
                    onClick={() =>
                      router.push(
                        `/dashboard/spreadsheets/editor?id=${sheet._id}`,
                      )
                    }
                    leading={<Sheet />}
                    title={sheet.title}
                    description={sheet.description}
                    meta={
                      <>
                        {sheet.tags.slice(0, 2).map((tag) => (
                          <Badge
                            key={tag}
                            variant="secondary"
                            className="hidden md:inline-flex"
                          >
                            {tag}
                          </Badge>
                        ))}
                        <span className="hidden lg:inline">
                          {sheet.sheetCount} · {sheet.rowCount}×{sheet.colCount}
                        </span>
                        <span className="hidden w-16 text-right sm:inline">
                          {formatBytes(sheet.sizeBytes)}
                        </span>
                        <span className="w-16 text-right">
                          {formatRelativeDate(sheet.updatedAt)}
                        </span>
                      </>
                    }
                    trailing={
                      <RowActions className="opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100">
                        <SheetMenu
                          onExport={() =>
                            api && downloadSpreadsheet(api, sheet)
                          }
                          onDelete={() => setDeleteTarget(sheet)}
                        />
                      </RowActions>
                    }
                  />
                ))}
              </List>
            )}
          </>
        )}
      </PageBody>

      <FormDialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) resetCreate();
        }}
        title="New spreadsheet"
        submitLabel="Create"
        submitDisabled={!createTitle.trim()}
        pending={creating}
        onSubmit={handleCreate}
      >
        <FormGrid>
          <FormField label="Title" htmlFor="sheet-title">
            <Input
              id="sheet-title"
              value={createTitle}
              onChange={(e) => setCreateTitle(e.target.value)}
              autoFocus
            />
          </FormField>
          <FormField label="Tags" htmlFor="sheet-tags" hint="Comma-separated">
            <Input
              id="sheet-tags"
              value={createTags}
              onChange={(e) => setCreateTags(e.target.value)}
            />
          </FormField>
          <FormField
            label="Description"
            htmlFor="sheet-description"
            className="sm:col-span-2"
          >
            <Textarea
              id="sheet-description"
              value={createDescription}
              onChange={(e) => setCreateDescription(e.target.value)}
              rows={3}
            />
          </FormField>
        </FormGrid>
      </FormDialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete ${deleteTarget?.title ?? "spreadsheet"}?`}
        description="The workbook is removed from storage."
        actionLabel="Delete"
        destructive
        onConfirm={() => {
          if (deleteTarget) void handleDelete(deleteTarget);
        }}
      />
    </Page>
  );
}

// Menu clicks bubble through the portal to the row's own onClick.
function SheetMenu({
  onExport,
  onDelete,
}: {
  onExport: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <DropdownMenuItem
        onClick={(event) => {
          event.stopPropagation();
          onExport();
        }}
      >
        <Download /> Export .xlsx
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        variant="destructive"
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
      >
        <Trash2 /> Delete
      </DropdownMenuItem>
    </>
  );
}
