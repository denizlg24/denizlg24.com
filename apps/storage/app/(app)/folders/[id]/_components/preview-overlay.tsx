"use client";

import { formatBytes, formatRelative } from "@repo/cloud-ui/format";
import type { StorageFile } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/popover";
import { ChevronLeft, ChevronRight, Download, Link2, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { FilePreview } from "@/components/file-preview";
import { api } from "@/lib/api";
import { SharePanel } from "./share-panel";

export function PreviewOverlay({
  files,
  fileId,
  onSelect,
  onClose,
}: {
  files: StorageFile[];
  fileId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const index = files.findIndex((file) => file.id === fileId);
  const file = index >= 0 ? files[index] : undefined;
  const previous = index > 0 ? files[index - 1] : undefined;
  const next =
    index >= 0 && index < files.length - 1 ? files[index + 1] : undefined;

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key === "ArrowLeft" && previous) {
        event.preventDefault();
        onSelect(previous.id);
      }
      if (event.key === "ArrowRight" && next) {
        event.preventDefault();
        onSelect(next.id);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onClose, onSelect, previous, next]);

  // The overlay owns the viewport while it is open, and focus has to follow it
  // in — otherwise Tab keeps walking the browser behind the overlay and screen
  // readers never enter the dialog. Focus goes back where it came from on
  // close so keyboard position is not lost.
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement;
    document.body.style.overflow = "hidden";
    containerRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, []);

  // The file can vanish underneath the overlay — deleted here, or renamed and
  // refetched. Closing properly also clears the ?preview= parameter, which a
  // bare `return null` would leave behind in a shareable URL.
  const missing = index < 0 && files.length > 0;
  useEffect(() => {
    if (missing) onClose();
  }, [missing, onClose]);

  if (!file) return null;

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex flex-col bg-background outline-none"
      role="dialog"
      aria-modal="true"
      aria-label={file.filename}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={file.filename}>
            {file.filename}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {formatBytes(file.sizeBytes)} · {formatRelative(file.updatedAt)}
            {files.length > 1 && ` · ${index + 1} of ${files.length}`}
          </p>
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8">
              <Link2 className="size-3.5" />
              <span className="hidden sm:inline">Share</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80">
            <SharePanel fileId={file.id} filename={file.filename} />
          </PopoverContent>
        </Popover>

        <Button variant="ghost" size="sm" className="h-8" asChild>
          <a href={api.url.fileDownload(file.id)} download={file.filename}>
            <Download className="size-3.5" />
            <span className="hidden sm:inline">Download</span>
          </a>
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Close preview"
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <FilePreview
          key={file.id}
          url={api.url.file(file.id)}
          downloadUrl={api.url.fileDownload(file.id)}
          filename={file.filename}
          mimeType={file.mimeType}
          sizeBytes={file.sizeBytes}
        />
        {previous && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous file"
            className="absolute left-2 top-1/2 size-9 -translate-y-1/2 rounded-full border bg-background/80 backdrop-blur"
            onClick={() => onSelect(previous.id)}
          >
            <ChevronLeft className="size-4" />
          </Button>
        )}
        {next && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next file"
            className="absolute right-2 top-1/2 size-9 -translate-y-1/2 rounded-full border bg-background/80 backdrop-blur"
            onClick={() => onSelect(next.id)}
          >
            <ChevronRight className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
