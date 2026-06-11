"use client";

import {
  ArrowLeft,
  Check,
  Download,
  Loader2,
  Pencil,
  Save,
  Sheet,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useUserSettings } from "@/context/user-context";
import { denizApi } from "@/lib/api-wrapper";
import type { FortuneSheetBook, ISpreadsheet } from "@/lib/data-types";

const SpreadsheetEditor = dynamic(
  () => import("./_components/spreadsheet-editor"),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    ),
  },
);

function EditorSkeleton() {
  return (
    <div className="flex flex-col gap-2 pb-0 h-full">
      <div className="flex items-center gap-2 px-4 border-b h-12 shrink-0">
        <Sheet className="size-4 text-muted-foreground" />
        <Skeleton className="h-4 w-40" />
        <div className="flex-1" />
        <Skeleton className="h-8 w-20" />
      </div>
      <div className="px-4 pt-3 flex-1">
        <Skeleton className="h-full w-full" />
      </div>
    </div>
  );
}

function EditorInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams.get("id");

  const { settings, loading: loadingSettings } = useUserSettings();
  const api = useMemo(() => {
    if (loadingSettings) return null;
    return new denizApi(settings.apiKey);
  }, [settings, loadingSettings]);

  const [meta, setMeta] = useState<ISpreadsheet | null>(null);
  const [content, setContent] = useState<FortuneSheetBook | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const [draftTags, setDraftTags] = useState("");

  const currentBookRef = useRef<FortuneSheetBook | null>(null);

  const fetchSheet = useCallback(async () => {
    if (!api || !id) return;
    const result = await api.GET<{
      spreadsheet: ISpreadsheet;
      content: FortuneSheetBook;
    }>({ endpoint: `spreadsheets/${id}` });
    if ("code" in result) {
      toast.error("Failed to load spreadsheet");
      setLoading(false);
      return;
    }
    setMeta(result.spreadsheet);
    setContent(result.content);
    currentBookRef.current = result.content;
    setLoading(false);
  }, [api, id]);

  useEffect(() => {
    fetchSheet();
  }, [fetchSheet]);

  const handleChange = useCallback((book: FortuneSheetBook) => {
    currentBookRef.current = book;
    setDirty(true);
  }, []);

  const handleSave = async () => {
    if (!api || !id || !currentBookRef.current) return;
    setSaving(true);
    const result = await api.PATCH<{ spreadsheet: ISpreadsheet }>({
      endpoint: `spreadsheets/${id}`,
      body: { content: currentBookRef.current },
    });
    setSaving(false);
    if ("code" in result) {
      toast.error("Failed to save");
      return;
    }
    setMeta(result.spreadsheet);
    setDirty(false);
    toast.success("Saved");
  };

  const handleExport = async () => {
    if (!api || !id || !meta) return;
    const res = await api.GET_RAW({
      endpoint: `spreadsheets/${id}/export`,
    });
    if ("code" in res) {
      toast.error("Failed to export");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${meta.title}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const openRename = () => {
    if (!meta) return;
    setDraftTitle(meta.title);
    setDraftDesc(meta.description ?? "");
    setDraftTags(meta.tags.join(", "));
    setRenameOpen(true);
  };

  const handleRename = async () => {
    if (!api || !id) return;
    const result = await api.PATCH<{ spreadsheet: ISpreadsheet }>({
      endpoint: `spreadsheets/${id}`,
      body: {
        title: draftTitle.trim(),
        description: draftDesc.trim() || undefined,
        tags: draftTags
          ? draftTags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          : [],
      },
    });
    if ("code" in result) {
      toast.error("Failed to update");
      return;
    }
    setMeta(result.spreadsheet);
    setRenameOpen(false);
    toast.success("Updated");
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (dirty && !saving) handleSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, saving, handleSave]);

  if (!id) {
    return (
      <div className="flex flex-col gap-2 pb-8">
        <div className="flex items-center gap-2 px-4 border-b h-12 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => router.push("/dashboard/spreadsheets")}
          >
            <ArrowLeft className="size-3.5" />
          </Button>
          <Sheet className="size-4 text-muted-foreground" />
          <span className="text-sm font-semibold flex-1">Missing id</span>
        </div>
        <div className="px-4 pt-12 text-center text-muted-foreground text-sm">
          No spreadsheet id provided.
        </div>
      </div>
    );
  }

  if (loadingSettings || loading) return <EditorSkeleton />;

  if (!meta || !content) {
    return (
      <div className="flex flex-col gap-2 pb-8">
        <div className="flex items-center gap-2 px-4 border-b h-12 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => router.push("/dashboard/spreadsheets")}
          >
            <ArrowLeft className="size-3.5" />
          </Button>
          <Sheet className="size-4 text-muted-foreground" />
          <span className="text-sm font-semibold flex-1">Not found</span>
        </div>
        <div className="px-4 pt-12 text-center text-muted-foreground text-sm">
          Spreadsheet not found.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 border-b h-12 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => router.push("/dashboard/spreadsheets")}
        >
          <ArrowLeft className="size-3.5" />
        </Button>
        <Sheet className="size-4 text-muted-foreground" />
        <button
          onClick={openRename}
          className="flex items-center gap-1.5 text-sm font-semibold hover:text-muted-foreground transition-colors"
        >
          {meta.title}
          <Pencil className="size-3 opacity-40" />
        </button>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {meta.rowCount}×{meta.colCount} · {meta.sheetCount} sheet
          {meta.sheetCount > 1 ? "s" : ""}
        </span>
        <div className="flex-1" />
        <span className="text-[11px] text-muted-foreground">
          {dirty ? (
            <span className="text-amber-600 dark:text-amber-500">
              Unsaved changes
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <Check className="size-3" />
              Saved
            </span>
          )}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs gap-1.5"
          onClick={handleExport}
        >
          <Download className="size-3.5" />
          Export
        </Button>
        <Button
          variant={dirty ? "default" : "ghost"}
          size="sm"
          className="h-8 text-xs gap-1.5"
          onClick={handleSave}
          disabled={!dirty || saving}
        >
          {saving ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Save className="size-3.5" />
          )}
          Save
        </Button>
      </div>

      <div className="flex-1 min-h-0">
        <SpreadsheetEditor initial={content} onChange={handleChange} />
      </div>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit details</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Title</Label>
              <Input
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Description</Label>
              <Textarea
                value={draftDesc}
                onChange={(e) => setDraftDesc(e.target.value)}
                rows={2}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Tags</Label>
              <Input
                value={draftTags}
                onChange={(e) => setDraftTags(e.target.value)}
                placeholder="comma-separated"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRenameOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleRename}
              disabled={!draftTitle.trim()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function SpreadsheetEditorPage() {
  return (
    <Suspense fallback={<EditorSkeleton />}>
      <EditorInner />
    </Suspense>
  );
}
