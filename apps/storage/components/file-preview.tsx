"use client";

import { Button } from "@repo/ui/button";
import { MarkdownRenderer } from "@repo/ui/markdown-renderer";
import { cn } from "@repo/ui/utils";
import hljs from "highlight.js/lib/common";
import { Download, Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { errorMessage } from "@/lib/api";
import { codeLanguage, type FileKind, fileKind } from "@/lib/file-kind";
import { formatBytes } from "@/lib/format";

const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_PDF_BYTES = 100 * 1024 * 1024;

function Notice({
  message,
  downloadUrl,
  filename,
}: {
  message: string;
  downloadUrl: string;
  filename: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
      <Button asChild variant="outline" size="sm">
        <a href={downloadUrl} download={filename}>
          <Download className="size-3.5" />
          Download
        </a>
      </Button>
    </div>
  );
}

function ImagePreview({ url, filename }: { url: string; filename: string }) {
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(true);

  return (
    <div className="relative flex flex-1 overflow-auto">
      {/* Ctrl/⌘+wheel zoom is an accelerator; the buttons below are the
          accessible path to every zoom level it reaches. */}
      <div
        className="flex min-h-full min-w-full items-center justify-center p-4"
        onWheel={(event) => {
          if (!event.ctrlKey && !event.metaKey) return;
          event.preventDefault();
          setFit(false);
          setZoom((value) =>
            Math.min(
              8,
              Math.max(0.1, value * (event.deltaY < 0 ? 1.15 : 0.87)),
            ),
          );
        }}
      >
        <img
          src={url}
          alt={filename}
          draggable={false}
          className={cn(
            "select-none",
            fit ? "max-h-full max-w-full object-contain" : "max-w-none",
          )}
          style={fit ? undefined : { width: `${zoom * 100}%` }}
        />
      </div>
      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border bg-background/95 px-1 py-0.5 shadow-sm backdrop-blur">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="Zoom out"
          onClick={() => {
            setFit(false);
            setZoom((value) => Math.max(0.1, value * 0.8));
          }}
        >
          <Minus className="size-3.5" />
        </Button>
        <button
          type="button"
          className="min-w-14 text-xs tabular-nums text-muted-foreground hover:text-foreground"
          onClick={() => {
            setFit((value) => !value);
            setZoom(1);
          }}
        >
          {fit ? "Fit" : `${Math.round(zoom * 100)}%`}
        </button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="Zoom in"
          onClick={() => {
            setFit(false);
            setZoom((value) => Math.min(8, value * 1.25));
          }}
        >
          <Plus className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

function CodeBlock({ text, filename }: { text: string; filename: string }) {
  const html = useMemo(() => {
    const language = codeLanguage(filename);
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(text, { language }).value;
    }
    return null;
  }, [text, filename]);

  return (
    <pre className="scrollbar-thin flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed">
      {html === null ? (
        <code className="hljs bg-transparent">{text}</code>
      ) : (
        <code
          className="hljs bg-transparent"
          // hljs escapes the source before emitting markup.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </pre>
  );
}

function TextLoader({
  url,
  filename,
  kind,
  sizeBytes,
  downloadUrl,
}: {
  url: string;
  filename: string;
  kind: FileKind;
  sizeBytes: number;
  downloadUrl: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (sizeBytes > MAX_TEXT_BYTES) return;
    const controller = new AbortController();
    setText(null);
    setError(null);
    fetch(url, { credentials: "include", signal: controller.signal })
      .then((response) => {
        if (!response.ok)
          throw new Error(`Request failed (${response.status})`);
        return response.text();
      })
      .then(setText)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(errorMessage(err));
      });
    return () => controller.abort();
  }, [url, sizeBytes]);

  if (sizeBytes > MAX_TEXT_BYTES) {
    return (
      <Notice
        message={`This file is ${formatBytes(sizeBytes)} — too big to show here. Download it to open in an editor.`}
        downloadUrl={downloadUrl}
        filename={filename}
      />
    );
  }
  if (error) {
    return (
      <Notice
        message={`Couldn't load this file: ${error}`}
        downloadUrl={downloadUrl}
        filename={filename}
      />
    );
  }
  if (text === null) {
    return (
      <p className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading…
      </p>
    );
  }
  if (kind === "markdown") {
    return (
      <div className="scrollbar-thin flex-1 overflow-auto px-4 py-6">
        <div className="mx-auto max-w-2xl">
          {/* Anyone can upload a .md and share the link, so raw HTML in the
              source must not execute on this origin. */}
          <MarkdownRenderer content={text} allowRawHtml={false} />
        </div>
      </div>
    );
  }
  if (kind === "code") return <CodeBlock text={text} filename={filename} />;
  return (
    <pre className="scrollbar-thin flex-1 overflow-auto whitespace-pre-wrap p-4 font-mono text-xs leading-relaxed">
      {text}
    </pre>
  );
}

function PdfPreview({
  url,
  filename,
  sizeBytes,
  downloadUrl,
}: {
  url: string;
  filename: string;
  sizeBytes: number;
  downloadUrl: string;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Framing the API URL directly would be a cross-origin document load; a blob
  // is same-origin, so the built-in PDF viewer works everywhere.
  useEffect(() => {
    if (sizeBytes > MAX_PDF_BYTES) return;
    const controller = new AbortController();
    let created: string | null = null;
    setError(null);
    fetch(url, { credentials: "include", signal: controller.signal })
      .then((response) => {
        if (!response.ok)
          throw new Error(`Request failed (${response.status})`);
        return response.blob();
      })
      .then((blob) => {
        created = URL.createObjectURL(blob);
        setBlobUrl(created);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(errorMessage(err));
      });
    return () => {
      controller.abort();
      if (created) URL.revokeObjectURL(created);
      setBlobUrl(null);
    };
  }, [url, sizeBytes]);

  if (sizeBytes > MAX_PDF_BYTES) {
    return (
      <Notice
        message={`This PDF is ${formatBytes(sizeBytes)} — too big to show here. Download it to read offline.`}
        downloadUrl={downloadUrl}
        filename={filename}
      />
    );
  }
  if (error) {
    return (
      <Notice
        message={`Couldn't load this PDF: ${error}`}
        downloadUrl={downloadUrl}
        filename={filename}
      />
    );
  }
  if (!blobUrl) {
    return (
      <p className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading…
      </p>
    );
  }
  return <iframe src={blobUrl} title={filename} className="flex-1 border-0" />;
}

export function FilePreview({
  url,
  downloadUrl,
  filename,
  mimeType,
  sizeBytes,
}: {
  url: string;
  downloadUrl: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number;
}) {
  const kind = fileKind(filename, mimeType);

  if (kind === "image") return <ImagePreview url={url} filename={filename} />;
  if (kind === "video") {
    return (
      // Without min-h-0 this flex item refuses to shrink below the video's
      // intrinsic height, so a portrait clip scales to the pane width and
      // overflows the viewport instead of fitting inside it.
      <div className="flex min-h-0 flex-1 items-center justify-center bg-black/90 p-4">
        {/* biome-ignore lint/a11y/useMediaCaption: user-uploaded media has no
            caption track available. */}
        <video
          src={url}
          controls
          className="max-h-full min-h-0 w-auto max-w-full object-contain"
        />
      </div>
    );
  }
  if (kind === "audio") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
        <p className="max-w-md truncate text-sm font-medium">{filename}</p>
        {/* biome-ignore lint/a11y/useMediaCaption: user-uploaded media has no
            caption track available. */}
        <audio src={url} controls className="w-full max-w-md" />
      </div>
    );
  }
  if (kind === "pdf") {
    return (
      <PdfPreview
        url={url}
        filename={filename}
        sizeBytes={sizeBytes}
        downloadUrl={downloadUrl}
      />
    );
  }
  if (kind === "markdown" || kind === "code" || kind === "text") {
    return (
      <TextLoader
        url={url}
        filename={filename}
        kind={kind}
        sizeBytes={sizeBytes}
        downloadUrl={downloadUrl}
      />
    );
  }
  return (
    <Notice
      message={
        kind === "archive"
          ? "Archives can't be opened in the browser. Download it to unpack."
          : "There's no preview for this file type yet."
      }
      downloadUrl={downloadUrl}
      filename={filename}
    />
  );
}
