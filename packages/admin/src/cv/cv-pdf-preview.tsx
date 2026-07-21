"use client";

import type { ICvFile } from "@repo/schemas";
import { FileOutput, Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import type { AdminClient } from "../client";
import type { PlatformBridge } from "../platform";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const MAX_PAGE_WIDTH = 800;

export default function CvPdfPreview({
  cv,
  draft,
  client,
  platform,
}: {
  cv: ICvFile | null;
  draft: ICvFile | null;
  client: AdminClient;
  platform: PlatformBridge;
}) {
  const active = draft ?? cv;
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [numPages, setNumPages] = useState(0);
  const [pageWidth, setPageWidth] = useState(0);
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) {
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
  }, [client, active]);

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
      {active ? (
        <button
          type="button"
          className="underline underline-offset-2 transition-colors hover:text-foreground"
          onClick={() => platform.openExternal(active.url)}
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
      ) : !active ? (
        fallback
      ) : !pdfFile ? (
        <div className="flex h-full min-h-80 items-center justify-center">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Document
          key={active.updatedAt}
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
