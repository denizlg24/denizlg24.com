"use client";

import { LatexEditor, type LatexProject } from "@repo/latex-editor";
import { createDefaultLatexProject } from "@repo/latex-editor/project";
import type { CvResponse, ICvFile } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { PageHeader } from "@repo/ui/page-header";
import { Skeleton } from "@repo/ui/skeleton";
import { HeaderBarSkeleton } from "@repo/ui/skeleton-blocks";
import {
  ExternalLink,
  FileOutput,
  FileUser,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { toast } from "sonner";
import type { AdminClient } from "../client";
import { AdminApiError } from "../client";
import type { PlatformBridge } from "../platform";
import { useAdmin } from "../provider";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const MAX_PAGE_WIDTH = 800;

interface CompileCvResponse extends CvResponse {
  log: string;
}

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

function CvPdfPreview({
  cv,
  client,
  platform,
}: {
  cv: ICvFile | null;
  client: AdminClient;
  platform: PlatformBridge;
}) {
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [numPages, setNumPages] = useState(0);
  const [pageWidth, setPageWidth] = useState(0);
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!cv) {
      setPdfData(null);
      return;
    }
    let cancelled = false;
    setPdfData(null);
    setPreviewError(false);
    setNumPages(0);
    void (async () => {
      try {
        const response = await client.raw("cv/file");
        const buffer = await response.arrayBuffer();
        if (!cancelled) setPdfData(new Uint8Array(buffer));
      } catch {
        if (!cancelled) setPreviewError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, cv]);

  useEffect(() => {
    const element = previewRef.current;
    if (!element) return;
    const update = () => setPageWidth(element.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const pdfFile = useMemo(
    () => (pdfData ? { data: pdfData } : null),
    [pdfData],
  );
  const fallback = (
    <div className="flex h-full min-h-80 items-center justify-center p-4 text-xs text-muted-foreground">
      {cv ? (
        <button
          type="button"
          className="underline underline-offset-2 transition-colors hover:text-foreground"
          onClick={() => platform.openExternal(cv.url)}
        >
          Open PDF
        </button>
      ) : (
        <FileOutput className="size-5 opacity-40" />
      )}
    </div>
  );

  return (
    <div ref={previewRef} className="h-full min-h-80 overflow-y-auto">
      {previewError ? (
        fallback
      ) : !cv ? (
        fallback
      ) : !pdfFile ? (
        <div className="flex h-full min-h-80 items-center justify-center">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Document
          key={cv.updatedAt}
          file={pdfFile}
          onLoadSuccess={({ numPages: total }) => setNumPages(total)}
          onLoadError={() => setPreviewError(true)}
          loading={
            <div className="flex h-full min-h-80 items-center justify-center">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          }
          error={fallback}
          className="flex flex-col items-center gap-3 p-3"
        >
          {Array.from({ length: numPages }, (_, index) => (
            <Page
              key={`page-${index + 1}`}
              pageNumber={index + 1}
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
  );
}

export function CvSkeleton() {
  return (
    <div className="flex h-full flex-col gap-2">
      <HeaderBarSkeleton
        icon={<FileUser className="size-4 text-muted-foreground" />}
        title="CV"
        actions={["w-20"]}
      />
      <div className="flex flex-1 flex-col gap-3 px-4 pt-3 pb-4">
        <Skeleton className="h-4 w-56" />
        <Skeleton className="min-h-[620px] w-full flex-1 rounded-lg" />
      </div>
    </div>
  );
}

export function CvPage() {
  const { client, platform, slots } = useAdmin();
  const [cv, setCv] = useState<ICvFile | null>(null);
  const [project, setProject] = useState<LatexProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchCv = useCallback(async () => {
    try {
      const result = await client.get<CvResponse>("cv");
      setCv(result.cv);
      setProject(result.project ?? createDefaultLatexProject());
    } catch {
      setProject((current) => current ?? createDefaultLatexProject());
      toast.error("Failed to load CV");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [client]);

  useEffect(() => {
    void fetchCv();
  }, [fetchCv]);

  if (loading || !project) return <CvSkeleton />;

  return (
    <div className="flex h-full flex-col gap-2 pb-4">
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={<FileUser className="size-4 text-muted-foreground" />}
        title="CV"
      >
        {cv && (
          <div className="hidden items-baseline gap-2 text-[10px] text-muted-foreground md:flex">
            <span className="font-medium text-foreground">{cv.filename}</span>
            <span className="tabular-nums">
              {formatBytes(cv.size)} · {formatUpdatedAt(cv.updatedAt)}
            </span>
          </div>
        )}
        {cv && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Open CV"
            onClick={() => platform.openExternal(cv.url)}
          >
            <ExternalLink />
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs"
          disabled={refreshing}
          onClick={() => {
            setRefreshing(true);
            void fetchCv();
          }}
        >
          <RefreshCw className={refreshing ? "animate-spin" : ""} />
          Refresh
        </Button>
      </PageHeader>

      <div className="flex min-h-0 flex-1 px-4 pt-1">
        <LatexEditor
          project={project}
          onChange={setProject}
          onSave={async (nextProject) => {
            const result = await client.put<CvResponse>("cv", nextProject);
            setProject(result.project ?? nextProject);
            toast.success("Source saved");
          }}
          onCompile={async (nextProject) => {
            try {
              const result = await client.post<CompileCvResponse>(
                "cv/compile",
                nextProject,
              );
              setCv(result.cv);
              setProject(result.project ?? nextProject);
              toast.success("CV compiled and published");
              return { log: result.log };
            } catch (error) {
              if (error instanceof AdminApiError) {
                const log = error.details?.log;
                if (typeof log === "string" && log.trim()) {
                  throw new Error(log);
                }
              }
              throw error;
            }
          }}
          compileLabel="Compile & publish"
          preview={<CvPdfPreview cv={cv} client={client} platform={platform} />}
        />
      </div>
    </div>
  );
}
