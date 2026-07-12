"use client";

import type { CvResponse, ICvFile } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { PageHeader } from "@repo/ui/page-header";
import { Skeleton } from "@repo/ui/skeleton";
import { HeaderBarSkeleton } from "@repo/ui/skeleton-blocks";
import {
  ExternalLink,
  FileUser,
  Loader2,
  RefreshCw,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { toast } from "sonner";
import { useAdmin } from "../provider";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_PAGE_WIDTH = 800;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatUpdatedAt(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CvSkeleton() {
  return (
    <div className="flex h-full flex-col gap-2">
      <HeaderBarSkeleton
        icon={<FileUser className="size-4 text-muted-foreground" />}
        title="CV"
        actions={["w-20", "w-28"]}
      />
      <div className="px-4 flex flex-1 flex-col gap-4 pt-3 pb-4">
        <Skeleton className="h-5 w-64" />
        <Skeleton className="w-full flex-1 min-h-[400px] rounded-md" />
      </div>
    </div>
  );
}

export function CvPage() {
  const { client, platform, slots } = useAdmin();

  const [cv, setCv] = useState<ICvFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [numPages, setNumPages] = useState(0);
  const [pageWidth, setPageWidth] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const fetchCv = useCallback(async () => {
    try {
      const result = await client.get<CvResponse>("cv");
      setCv(result.cv);
    } catch {
      toast.error("Failed to load CV");
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    fetchCv();
  }, [fetchCv]);

  useEffect(() => {
    if (!cv) {
      setPdfData(null);
      return;
    }
    let cancelled = false;
    setPdfData(null);
    setPreviewError(false);
    setNumPages(0);
    (async () => {
      try {
        const res = await client.raw("cv/file");
        const buf = await res.arrayBuffer();
        if (!cancelled) setPdfData(new Uint8Array(buf));
      } catch {
        if (!cancelled) setPreviewError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, cv]);

  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const update = () => setPageWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [cv]);

  const pdfFile = useMemo(
    () => (pdfData ? { data: pdfData } : null),
    [pdfData],
  );

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const isPdf =
      file.type === "application/pdf" ||
      file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      toast.error("Only PDF files are allowed");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error("File exceeds 10MB limit");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await client.upload<CvResponse>("cv", formData);
      setCv(result.cv);
      toast.success("CV updated");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to upload CV",
      );
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return <CvSkeleton />;
  }

  const previewFallback = (
    <div className="flex h-full min-h-[400px] items-center justify-center p-4 text-sm text-muted-foreground">
      <span>
        Preview unavailable &mdash;{" "}
        <button
          type="button"
          className="underline underline-offset-2 hover:text-foreground transition-colors"
          onClick={() => cv && platform.openExternal(cv.url)}
        >
          open externally
        </button>
        .
      </span>
    </div>
  );

  return (
    <div className="flex flex-col gap-2 pb-8 h-full">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={handleFileSelected}
      />

      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={<FileUser className="size-4 text-muted-foreground" />}
        title="CV"
      >
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs gap-1.5"
          onClick={() => {
            setLoading(true);
            fetchCv();
          }}
        >
          <RefreshCw className="size-3.5" />
          Refresh
        </Button>

        <Button
          size="sm"
          className="h-8 text-xs gap-1.5"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Upload className="size-3.5" />
          )}
          {uploading ? "Uploading..." : cv ? "Replace PDF" : "Upload PDF"}
        </Button>
      </PageHeader>

      <div className="px-4 flex flex-col gap-4 pt-3 pb-4 flex-1 min-h-0">
        {cv ? (
          <>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{cv.filename}</span>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  title="Open CV"
                  onClick={() => platform.openExternal(cv.url)}
                >
                  <ExternalLink className="size-3.5" />
                </button>
              </div>
              <p className="text-xs text-muted-foreground tabular-nums">
                {formatBytes(cv.size)} &middot; {formatUpdatedAt(cv.updatedAt)}
              </p>
            </div>

            <div
              ref={previewRef}
              className="flex-1 min-h-[400px] overflow-y-auto rounded-md border bg-muted/20"
            >
              {previewError ? (
                previewFallback
              ) : !pdfFile ? (
                <div className="flex h-full min-h-[400px] items-center justify-center">
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <Document
                  key={cv.updatedAt}
                  file={pdfFile}
                  onLoadSuccess={({ numPages: total }) => setNumPages(total)}
                  onLoadError={() => setPreviewError(true)}
                  loading={
                    <div className="flex h-full min-h-[400px] items-center justify-center">
                      <Loader2 className="size-4 animate-spin text-muted-foreground" />
                    </div>
                  }
                  error={previewFallback}
                  className="flex flex-col items-center gap-3 py-3"
                >
                  {Array.from({ length: numPages }, (_, i) => (
                    <Page
                      key={`page-${i + 1}`}
                      pageNumber={i + 1}
                      width={
                        pageWidth > 0
                          ? Math.min(pageWidth - 24, MAX_PAGE_WIDTH)
                          : undefined
                      }
                      renderTextLayer={false}
                      renderAnnotationLayer={false}
                      className="shadow-sm"
                    />
                  ))}
                </Document>
              )}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No CV uploaded yet.</p>
        )}
      </div>
    </div>
  );
}
