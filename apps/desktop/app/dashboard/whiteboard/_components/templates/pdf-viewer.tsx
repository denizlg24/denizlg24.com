"use client";

import {
  ChevronLeft,
  ChevronRight,
  FileUp,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { Button } from "@/components/ui/button";
import { useUserSettings } from "@/context/user-context";
import { denizApi } from "@/lib/api-wrapper";
import type { TemplateProps } from ".";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export const PdfViewerTemplate = ({
  width,
  height,
  data,
  onDataChange,
}: TemplateProps) => {
  const { settings } = useUserSettings();
  const pdfUrl = data.pdfUrl as string | undefined;
  const pdfBase64 = data.pdfBase64 as string | undefined;
  const fileName = (data.fileName as string) || "Untitled.pdf";
  const [currentPage, setCurrentPage] = useState(
    (data.currentPage as number) || 1,
  );
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pdfScale, setPdfScale] = useState((data.pdfScale as number) || 1);
  const [loading, setLoading] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  const handleDragStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest("a, button, input, [role=button]")) return;

      const container = scrollContainerRef.current;
      if (!container) return;

      isDragging.current = true;
      dragStart.current = {
        x: e.clientX,
        y: e.clientY,
        scrollLeft: container.scrollLeft,
        scrollTop: container.scrollTop,
      };
      container.style.cursor = "grabbing";
      container.setPointerCapture(e.pointerId);
    },
    [],
  );

  const handleDragMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging.current) return;
      const container = scrollContainerRef.current;
      if (!container) return;

      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      container.scrollLeft = dragStart.current.scrollLeft - dx;
      container.scrollTop = dragStart.current.scrollTop - dy;
    },
    [],
  );

  const handleDragEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current) return;
    isDragging.current = false;
    const container = scrollContainerRef.current;
    if (container) {
      container.style.cursor = "grab";
      container.releasePointerCapture(e.pointerId);
    }
  }, []);

  const pdfData = useMemo(() => {
    if (pdfUrl) return pdfUrl;
    if (pdfBase64) return { data: base64ToUint8(pdfBase64) };
    return null;
  }, [pdfUrl, pdfBase64]);

  const handleImportPdf = useCallback(async () => {
    try {
      setLoading(true);
      const { open } = await import("@tauri-apps/plugin-dialog");
      const { readFile } = await import("@tauri-apps/plugin-fs");

      const selected = await open({
        multiple: false,
        filters: [{ name: "PDF Files", extensions: ["pdf"] }],
      });

      if (!selected) {
        setLoading(false);
        return;
      }

      const filePath = typeof selected === "string" ? selected : selected;
      const bytes = await readFile(filePath as string);
      const name = (filePath as string).split(/[/\\]/).pop() || "Untitled.pdf";

      const file = new File([bytes], name, { type: "application/pdf" });
      const formData = new FormData();
      formData.append("file", file);

      const api = new denizApi(settings.apiKey);
      const result = await api.UPLOAD<{ url: string; hash: string }>({
        endpoint: "upload",
        formData,
      });

      if ("code" in result) {
        return;
      }

      const { pdfBase64: _removed, ...rest } = data;
      onDataChange({
        ...rest,
        pdfUrl: result.url,
        fileName: name,
        currentPage: 1,
        pdfScale: 1,
      });
      setCurrentPage(1);
      setPdfScale(1);
    } catch (err) {
      console.error("Failed to import PDF:", err);
    } finally {
      setLoading(false);
    }
  }, [data, onDataChange, settings.apiKey]);

  const onDocumentLoadSuccess = useCallback(
    ({ numPages: total }: { numPages: number }) => {
      setNumPages(total);
    },
    [],
  );

  const goToPage = useCallback(
    (page: number) => {
      const p = Math.max(1, Math.min(page, numPages || 1));
      setCurrentPage(p);
      onDataChange({ ...data, currentPage: p });
    },
    [numPages, data, onDataChange],
  );

  const adjustScale = useCallback(
    (delta: number) => {
      const newScale = Math.max(0.25, Math.min(3, pdfScale + delta));
      setPdfScale(newScale);
      onDataChange({ ...data, pdfScale: newScale });
    },
    [pdfScale, data, onDataChange],
  );

  const pageWidth = width - 16;

  if (!pdfData) {
    return (
      <div
        className="border border-border bg-background shadow-sm rounded-lg flex flex-col items-center justify-center gap-3"
        style={{ width, height }}
      >
        <FileUp className="size-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">No PDF loaded</p>
        <Button size="sm" onClick={handleImportPdf} disabled={loading}>
          {loading ? "Uploading..." : "Import PDF"}
        </Button>
      </div>
    );
  }

  return (
    <div
      className="border border-border bg-background shadow-sm rounded-lg flex flex-col"
      style={{ width, height }}
    >
      <div className="flex items-center justify-between px-3 pt-2 pb-2 border-b bg-input/25 rounded-tl-lg rounded-tr-lg shrink-0 gap-2">
        <span className="text-xs font-medium truncate flex-1" title={fileName}>
          {fileName}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={handleImportPdf}
          title="Replace PDF"
          disabled={loading}
        >
          <FileUp className="size-3.5" />
        </Button>
      </div>

      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-auto flex items-start justify-center p-2 bg-muted/20 select-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ cursor: "grab" }}
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
      >
        <Document
          file={pdfData}
          onLoadSuccess={onDocumentLoadSuccess}
          loading={
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              Loading PDF...
            </div>
          }
          error={
            <div className="flex items-center justify-center h-full text-sm text-destructive">
              Failed to load PDF
            </div>
          }
        >
          <Page
            pageNumber={currentPage}
            width={pageWidth * pdfScale}
            renderTextLayer
            renderAnnotationLayer
          />
        </Document>
      </div>

      <div className="flex items-center justify-between px-2 py-1.5 border-t bg-input/25 rounded-bl-lg rounded-br-lg shrink-0">
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => adjustScale(-0.25)}
            disabled={pdfScale <= 0.25}
          >
            <ZoomOut className="size-3.5" />
          </Button>
          <span className="text-xs text-muted-foreground w-10 text-center">
            {Math.round(pdfScale * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => adjustScale(0.25)}
            disabled={pdfScale >= 3}
          >
            <ZoomIn className="size-3.5" />
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage <= 1}
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <span className="text-xs text-muted-foreground min-w-[3.5rem] text-center">
            {currentPage} / {numPages ?? "?"}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage >= (numPages ?? 1)}
          >
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
};
