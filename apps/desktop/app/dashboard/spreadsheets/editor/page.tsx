"use client";

import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { ConfirmDialog } from "@repo/ui/confirm-button";
import { EmptyState } from "@repo/ui/empty-state";
import { FormDialog, FormField, FormGrid } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import { Page, PageBody } from "@repo/ui/page";
import { Skeleton } from "@repo/ui/skeleton";
import { Spinner } from "@repo/ui/spinner";
import { Textarea } from "@repo/ui/textarea";
import { Download, Pencil, Save, Sheet } from "lucide-react";
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
import { DashboardPageHeader } from "@/components/navigation/dashboard-page-header";
import { useUserSettings } from "@/context/user-context";
import { denizApi } from "@/lib/api-wrapper";
import type { FortuneSheetBook, ISpreadsheet } from "@/lib/data-types";
import { downloadSpreadsheet } from "../_components/download";

const LIST_HREF = "/dashboard/spreadsheets";

const SpreadsheetEditor = dynamic(
  () => import("./_components/spreadsheet-editor"),
  {
    ssr: false,
    loading: () => <Skeleton className="h-full w-full rounded-none" />,
  },
);

function parseTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function EditorSkeleton() {
  return (
    <Page>
      <DashboardPageHeader
        crumbs={[{ label: "Spreadsheets" }]}
        icon={<Sheet />}
        title={<Skeleton className="h-4 w-40" />}
      />
      <PageBody bleed>
        <Skeleton className="h-full w-full rounded-none" />
      </PageBody>
    </Page>
  );
}

function EditorInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams.get("id");

  const { loading: loadingSettings } = useUserSettings();
  const api = useMemo(
    () => (loadingSettings ? null : new denizApi()),
    [loadingSettings],
  );

  const [meta, setMeta] = useState<ISpreadsheet | null>(null);
  const [content, setContent] = useState<FortuneSheetBook | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsPending, setDetailsPending] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const [draftTags, setDraftTags] = useState("");
  const [leaveOpen, setLeaveOpen] = useState(false);

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
    if (!api || !id || !currentBookRef.current || saving) return;
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
  };

  const saveRef = useRef(handleSave);
  saveRef.current = handleSave;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (dirtyRef.current) void saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const leave = () => {
    if (dirty) setLeaveOpen(true);
    else router.push(LIST_HREF);
  };

  const openDetails = () => {
    if (!meta) return;
    setDraftTitle(meta.title);
    setDraftDesc(meta.description ?? "");
    setDraftTags(meta.tags.join(", "));
    setDetailsOpen(true);
  };

  const handleDetails = async () => {
    if (!api || !id || !draftTitle.trim()) return;
    setDetailsPending(true);
    const result = await api.PATCH<{ spreadsheet: ISpreadsheet }>({
      endpoint: `spreadsheets/${id}`,
      body: {
        title: draftTitle.trim(),
        description: draftDesc.trim() || undefined,
        tags: parseTags(draftTags),
      },
    });
    setDetailsPending(false);
    if ("code" in result) {
      toast.error("Failed to update");
      return;
    }
    setMeta(result.spreadsheet);
    setDetailsOpen(false);
  };

  if (!id || (!loading && !loadingSettings && (!meta || !content))) {
    return (
      <Page>
        <DashboardPageHeader
          crumbs={[
            { label: "Spreadsheets", onClick: () => router.push(LIST_HREF) },
          ]}
          icon={<Sheet />}
          title="Not found"
        />
        <EmptyState icon={<Sheet />} label="Spreadsheet not found" />
      </Page>
    );
  }

  if (loadingSettings || loading || !meta || !content)
    return <EditorSkeleton />;

  return (
    <Page>
      <DashboardPageHeader
        crumbs={[{ label: "Spreadsheets", onClick: leave }]}
        icon={<Sheet />}
        title={meta.title}
      >
        <span className="mr-2 hidden text-xs tabular-nums text-muted-foreground md:inline">
          {meta.rowCount}×{meta.colCount} · {meta.sheetCount}{" "}
          {meta.sheetCount === 1 ? "sheet" : "sheets"}
        </span>
        {dirty ? (
          <Badge variant="warning">Unsaved</Badge>
        ) : (
          <Badge variant="ghost">Saved</Badge>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Edit details"
          onClick={openDetails}
        >
          <Pencil />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => api && downloadSpreadsheet(api, meta)}
        >
          <Download /> Export
        </Button>
        <Button size="sm" onClick={handleSave} disabled={!dirty || saving}>
          {saving ? <Spinner className="size-3.5" /> : <Save />}
          Save
        </Button>
      </DashboardPageHeader>

      <PageBody bleed>
        <SpreadsheetEditor initial={content} onChange={handleChange} />
      </PageBody>

      <FormDialog
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        title="Edit details"
        submitDisabled={!draftTitle.trim()}
        pending={detailsPending}
        onSubmit={handleDetails}
      >
        <FormGrid>
          <FormField label="Title" htmlFor="sheet-details-title">
            <Input
              id="sheet-details-title"
              autoFocus
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
            />
          </FormField>
          <FormField
            label="Tags"
            htmlFor="sheet-details-tags"
            hint="Comma-separated"
          >
            <Input
              id="sheet-details-tags"
              value={draftTags}
              onChange={(e) => setDraftTags(e.target.value)}
            />
          </FormField>
          <FormField
            label="Description"
            htmlFor="sheet-details-description"
            className="sm:col-span-2"
          >
            <Textarea
              id="sheet-details-description"
              value={draftDesc}
              onChange={(e) => setDraftDesc(e.target.value)}
              rows={3}
            />
          </FormField>
        </FormGrid>
      </FormDialog>

      <ConfirmDialog
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
        title="Discard unsaved changes?"
        actionLabel="Discard"
        destructive
        onConfirm={() => router.push(LIST_HREF)}
      />
    </Page>
  );
}

export default function SpreadsheetEditorPage() {
  return (
    <Suspense fallback={<EditorSkeleton />}>
      <EditorInner />
    </Suspense>
  );
}
