"use client";

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Download,
  FileUp,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Sheet,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useUserSettings } from "@/context/user-context";
import { denizApi } from "@/lib/api-wrapper";
import type { ISpreadsheet } from "@/lib/data-types";

function formatRelativeDate(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function SortHeader({
  label,
  column,
}: {
  label: string;
  column: {
    getIsSorted: () => false | "asc" | "desc";
    toggleSorting: (desc: boolean) => void;
  };
}) {
  const sorted = column.getIsSorted();
  return (
    <button
      className="flex items-center gap-1 hover:text-foreground transition-colors"
      onClick={() => column.toggleSorting(sorted === "asc")}
    >
      {label}
      {sorted === "asc" ? (
        <ArrowUp className="size-3" />
      ) : sorted === "desc" ? (
        <ArrowDown className="size-3" />
      ) : (
        <ArrowUpDown className="size-3 opacity-40" />
      )}
    </button>
  );
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-2 pb-8">
      <div className="flex items-center gap-2 px-4 border-b h-12 shrink-0">
        <Sheet className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold flex-1">Spreadsheets</span>
      </div>
      <div className="px-4 flex flex-col gap-6 pt-3">
        <div className="flex items-baseline gap-8">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col gap-1">
              <Skeleton className="h-3 w-14" />
              <Skeleton className="h-6 w-8" />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-0">
          <Skeleton className="h-10 w-full" />
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3 py-3 border-b">
              <Skeleton className="h-4 w-40 flex-1" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-6 w-6 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function SpreadsheetsPage() {
  const router = useRouter();
  const { settings, loading: loadingSettings } = useUserSettings();

  const api = useMemo(() => {
    if (loadingSettings) return null;
    return new denizApi(settings.apiKey);
  }, [settings, loadingSettings]);

  const [sheets, setSheets] = useState<ISpreadsheet[]>([]);
  const [loading, setLoading] = useState(true);
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
    if (!("code" in result)) {
      setSheets(result.spreadsheets);
    } else {
      toast.error("Failed to load spreadsheets");
    }
    setLoading(false);
  }, [api]);

  useEffect(() => {
    fetchSheets();
  }, [fetchSheets]);

  const totals = useMemo(() => {
    const totalBytes = sheets.reduce((a, s) => a + (s.sizeBytes || 0), 0);
    const totalSheets = sheets.reduce((a, s) => a + (s.sheetCount || 0), 0);
    return {
      count: sheets.length,
      sheets: totalSheets,
      size: totalBytes,
    };
  }, [sheets]);

  const handleCreate = async () => {
    if (!api || !createTitle.trim()) return;
    setCreating(true);
    const result = await api.POST<{ spreadsheet: ISpreadsheet }>({
      endpoint: "spreadsheets",
      body: {
        title: createTitle.trim(),
        description: createDescription.trim() || undefined,
        tags: createTags
          ? createTags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          : [],
      },
    });
    setCreating(false);
    if ("code" in result) {
      toast.error("Failed to create spreadsheet");
      return;
    }
    toast.success("Spreadsheet created");
    setCreateOpen(false);
    setCreateTitle("");
    setCreateDescription("");
    setCreateTags("");
    router.push(`/dashboard/spreadsheets/editor?id=${result.spreadsheet._id}`);
  };

  const handleImport = async () => {
    if (!api) return;
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Spreadsheets", extensions: ["xlsx", "xls", "csv"] }],
      });
      if (!selected || typeof selected !== "string") return;

      setImporting(true);
      const bytes = await readFile(selected);
      const filename = selected.split(/[\\/]/).pop() ?? "import.xlsx";
      const blob = new Blob([new Uint8Array(bytes)], {
        type: "application/octet-stream",
      });
      const file = new File([blob], filename);

      const formData = new FormData();
      formData.append("file", file);

      const result = await api.UPLOAD<{ spreadsheet: ISpreadsheet }>({
        endpoint: "spreadsheets/import",
        formData,
      });
      setImporting(false);

      if ("code" in result) {
        toast.error("Failed to import spreadsheet");
        return;
      }
      toast.success("Spreadsheet imported");
      await fetchSheets();
      router.push(
        `/dashboard/spreadsheets/editor?id=${result.spreadsheet._id}`,
      );
    } catch (err) {
      setImporting(false);
      toast.error((err as Error).message ?? "Import failed");
    }
  };

  const handleExport = async (sheet: ISpreadsheet) => {
    if (!api) return;
    const res = await api.GET_RAW({
      endpoint: `spreadsheets/${sheet._id}/export`,
    });
    if ("code" in res) {
      toast.error("Failed to export");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sheet.title}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleDelete = async () => {
    if (!api || !deleteTarget) return;
    const target = deleteTarget;
    setSheets((prev) => prev.filter((s) => s._id !== target._id));
    setDeleteTarget(null);
    const result = await api.DELETE<{ message: string }>({
      endpoint: `spreadsheets/${target._id}`,
    });
    if ("code" in result) {
      toast.error("Failed to delete spreadsheet");
      fetchSheets();
      return;
    }
    toast.success("Spreadsheet deleted");
  };

  const columns: ColumnDef<ISpreadsheet, unknown>[] = useMemo(
    () => [
      {
        accessorKey: "title",
        header: ({ column }) => <SortHeader label="Title" column={column} />,
        cell: ({ row }) => {
          const s = row.original;
          return (
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">{s.title}</span>
              {s.description && (
                <span className="text-[11px] text-muted-foreground truncate max-w-[360px]">
                  {s.description}
                </span>
              )}
            </div>
          );
        },
      },
      {
        accessorKey: "sheetCount",
        header: "Sheets",
        cell: ({ row }) => (
          <span className="text-muted-foreground tabular-nums">
            {row.original.sheetCount}
          </span>
        ),
      },
      {
        id: "dimensions",
        header: "Size",
        cell: ({ row }) => (
          <span className="text-muted-foreground tabular-nums">
            {row.original.rowCount}×{row.original.colCount}
          </span>
        ),
      },
      {
        accessorKey: "sizeBytes",
        header: ({ column }) => <SortHeader label="Bytes" column={column} />,
        cell: ({ row }) => (
          <span className="text-muted-foreground tabular-nums">
            {formatBytes(row.original.sizeBytes)}
          </span>
        ),
      },
      {
        accessorKey: "updatedAt",
        header: ({ column }) => <SortHeader label="Updated" column={column} />,
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {formatRelativeDate(row.original.updatedAt)}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const s = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    handleExport(s);
                  }}
                >
                  <Download className="size-3.5" />
                  Export .xlsx
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteTarget(s);
                  }}
                  variant="destructive"
                >
                  <Trash2 className="size-3.5" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handleExport],
  );

  const [sorting, setSorting] = useState<SortingState>([
    { id: "updatedAt", desc: true },
  ]);

  const table = useReactTable({
    data: sheets,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: { sorting },
  });

  if (loadingSettings || loading) {
    return <LoadingSkeleton />;
  }

  if (!api) {
    return (
      <div className="flex flex-col gap-2 pb-8">
        <div className="flex items-center gap-2 px-4 border-b h-12 shrink-0">
          <Sheet className="size-4 text-muted-foreground" />
          <span className="text-sm font-semibold flex-1">Spreadsheets</span>
        </div>
        <div className="px-4 pt-12 text-center text-muted-foreground text-sm">
          Failed to initialize API client.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 pb-8 h-full">
      <div className="flex items-center gap-2 px-4 border-b h-12 shrink-0">
        <Sheet className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold flex-1">Spreadsheets</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs gap-1.5"
          onClick={handleImport}
          disabled={importing}
        >
          <FileUp className={`size-3.5 ${importing ? "animate-pulse" : ""}`} />
          Import
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs gap-1.5"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="size-3.5" />
          New
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs gap-1.5"
          onClick={() => {
            setLoading(true);
            fetchSheets();
          }}
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="px-4 flex flex-col gap-4 pt-3 flex-1 min-h-0 overflow-y-auto">
        <div className="flex items-baseline gap-8 flex-wrap">
          <Stat label="Total" value={totals.count} />
          <Stat label="Sheets" value={totals.sheets} />
          <Stat label="Storage" value={formatBytes(totals.size)} />
        </div>

        <Separator />

        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className="text-xs">
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() =>
                    router.push(
                      `/dashboard/spreadsheets/editor?id=${row.original._id}`,
                    )
                  }
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="text-xs">
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-32 text-center text-muted-foreground text-sm"
                >
                  <div className="flex flex-col items-center gap-3">
                    <Sheet className="size-8 opacity-40" />
                    <span>No spreadsheets yet</span>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setCreateOpen(true)}
                      >
                        <Plus className="size-3.5" />
                        New
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={handleImport}
                      >
                        <FileUp className="size-3.5" />
                        Import
                      </Button>
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New spreadsheet</DialogTitle>
            <DialogDescription>
              Blank workbook. You can rename and fill it next.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Title</Label>
              <Input
                value={createTitle}
                onChange={(e) => setCreateTitle(e.target.value)}
                placeholder="Monthly budget"
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Description</Label>
              <Textarea
                value={createDescription}
                onChange={(e) => setCreateDescription(e.target.value)}
                placeholder="Optional"
                rows={2}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Tags</Label>
              <Input
                value={createTags}
                onChange={(e) => setCreateTags(e.target.value)}
                placeholder="finance, personal (comma-separated)"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCreateOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={creating || !createTitle.trim()}
            >
              {creating ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete spreadsheet?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.title} will be removed and unpinned from storage.
              This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums tracking-tight">
        {value}
      </p>
    </div>
  );
}
