"use client";

import { Button } from "@repo/ui/button";
import { EmptyState } from "@repo/ui/empty-state";
import { Spinner } from "@repo/ui/spinner";
import { FileOutput, RefreshCw } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Document, Page, pdfjs } from "react-pdf";
import type { AdminClient } from "../client";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const MAX_PAGE_WIDTH = 900;

export function PdfBytesPreview({
  data,
  resetKey,
  errorNode,
}: {
  data: Uint8Array;
  resetKey?: string | number;
  errorNode?: ReactNode;
}) {
  const [numPages, setNumPages] = useState(0);
  const [pageWidth, setPageWidth] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = previewRef.current;
    if (!element) return;
    const update = () => setPageWidth(element.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Copy the bytes so pdf.js transferring the buffer to its worker never
  // detaches the caller's array across re-renders.
  const pdfFile = useMemo(() => ({ data: data.slice() }), [data]);

  const loadingNode = (
    <div className="flex h-full min-h-80 items-center justify-center">
      <Spinner className="size-4 text-muted-foreground" />
    </div>
  );
  const failure = error
    ? (errorNode ?? (
        <div className="flex h-full min-h-80 items-center justify-center px-6 text-center text-xs text-muted-foreground">
          {error}
        </div>
      ))
    : null;

  return (
    <div
      ref={previewRef}
      className="h-full min-h-80 overflow-y-auto bg-surface/40"
    >
      {failure ?? (
        <Document
          suspense={false}
          key={resetKey}
          file={pdfFile}
          onLoadSuccess={({ numPages: total }) => setNumPages(total)}
          onLoadError={(caught) =>
            setError(
              caught instanceof Error ? caught.message : "PDF unavailable",
            )
          }
          loading={loadingNode}
          className="flex flex-col items-center gap-3 p-3"
        >
          {Array.from({ length: numPages }, (_, index) => (
            <Page
              key={`page-${index + 1}`}
              pageNumber={index + 1}
              width={
                pageWidth > 0
                  ? Math.min(Math.max(1, pageWidth - 24), MAX_PAGE_WIDTH)
                  : undefined
              }
              renderTextLayer={false}
              renderAnnotationLayer={false}
              className="ring-1 ring-border"
            />
          ))}
        </Document>
      )}
    </div>
  );
}

export function LatexAssetPdfPreview({ content }: { content: string }) {
  const data = useMemo(() => {
    try {
      const binary = atob(content);
      return Uint8Array.from(binary, (char) => char.charCodeAt(0));
    } catch {
      return null;
    }
  }, [content]);
  if (!data) {
    return (
      <EmptyState
        icon={<FileOutput />}
        label="Unreadable PDF"
        className="h-full"
      />
    );
  }
  return <PdfBytesPreview data={data} />;
}

export function LatexProjectPdfPreview({
  client,
  projectId,
  revision,
}: {
  client: AdminClient;
  projectId: string;
  revision: number | null;
}) {
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((current) => current + 1), []);

  useEffect(() => {
    if (revision === null) {
      setPdfData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPdfData(null);
    void client
      .raw(`latex/projects/${projectId}/pdf`)
      .then((response) => response.arrayBuffer())
      .then((buffer) => {
        if (!cancelled) setPdfData(new Uint8Array(buffer));
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(
            caught instanceof Error ? caught.message : "PDF unavailable",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, projectId, reloadKey, revision]);

  if (revision === null) {
    return (
      <EmptyState
        icon={<FileOutput />}
        label="Not compiled"
        className="h-full"
      />
    );
  }

  const fallback = (
    <EmptyState
      icon={<FileOutput />}
      label={error ?? "PDF unavailable"}
      className="h-full px-6"
      action={
        <Button variant="outline" size="sm" onClick={reload}>
          <RefreshCw /> Retry
        </Button>
      }
    />
  );

  if (error) return fallback;
  if (loading || !pdfData) {
    return (
      <div className="flex h-full min-h-80 items-center justify-center">
        <Spinner className="size-4 text-muted-foreground" />
      </div>
    );
  }
  return (
    <PdfBytesPreview
      data={pdfData}
      resetKey={`${revision}-${reloadKey}`}
      errorNode={fallback}
    />
  );
}
