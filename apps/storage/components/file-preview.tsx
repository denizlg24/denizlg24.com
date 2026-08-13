"use client";

import { formatBytes } from "@repo/cloud-ui/format";
import { looksBinary, parseDelimited } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/utils";
import { Download, Minus, Plus } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import {
  codeLanguage,
  extensionOf,
  type FileKind,
  fileKind,
} from "@/lib/file-kind";

const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_PDF_BYTES = 100 * 1024 * 1024;
const MAX_FONT_BYTES = 32 * 1024 * 1024;
/** Enough of an unknown file to tell text from binary, and cheap on a phone. */
const PROBE_BYTES = 64 * 1024;
/** Rows rendered from a delimited file. The count of the rest is still shown. */
const MAX_TABLE_ROWS = 2_000;

// react-markdown + rehype-highlight + katex is the single heaviest dependency
// in this app and only a .md preview reaches it.
const MarkdownRenderer = dynamic(
  () => import("@repo/ui/markdown-renderer").then((m) => m.MarkdownRenderer),
  { ssr: false },
);

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
  const stageRef = useRef<HTMLDivElement>(null);

  // React registers onWheel passively, so preventDefault there is ignored and
  // the browser page-zooms anyway. Ctrl/⌘+wheel has to be a native listener
  // opted out of passive to suppress that.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setFit(false);
      setZoom((value) =>
        Math.min(8, Math.max(0.1, value * (event.deltaY < 0 ? 1.15 : 0.87))),
      );
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div className="relative flex flex-1 overflow-auto">
      {/* Ctrl/⌘+wheel zoom is an accelerator; the buttons below are the
          accessible path to every zoom level it reaches. */}
      <div
        ref={stageRef}
        className="flex min-h-full min-w-full items-center justify-center p-4"
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
  const [html, setHtml] = useState<string | null>(null);

  // highlight.js/lib/common is ~250 kB and only a source-file preview ever
  // needs it, so it stays out of the browse and share-landing first loads.
  useEffect(() => {
    const language = codeLanguage(filename);
    if (!language) {
      setHtml(null);
      return;
    }
    let active = true;
    // Drop the previous file's markup before awaiting the chunk. Without this
    // an unrecognised language leaves the old highlighted HTML rendered
    // against the new file's text.
    setHtml(null);
    void (async () => {
      try {
        const { default: hljs } = await import("highlight.js/lib/common");
        if (!active || !hljs.getLanguage(language)) return;
        setHtml(hljs.highlight(text, { language }).value);
      } catch {
        if (active) setHtml(null);
      }
    })();
    return () => {
      active = false;
    };
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
  // A big log or export is exactly the file whose opening lines are worth
  // seeing, so past the limit this reads a head rather than refusing. Structured
  // renderers are skipped for those: half a markdown document or a CSV cut
  // mid-row renders as something the file is not.
  const partial = sizeBytes > MAX_TEXT_BYTES;

  useEffect(() => {
    const controller = new AbortController();
    setText(null);
    setError(null);
    api
      .fetchFile(
        url,
        controller.signal,
        sizeBytes > MAX_TEXT_BYTES ? MAX_TEXT_BYTES : undefined,
      )
      .then((response) => response.text())
      .then(setText)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(errorMessage(err));
      });
    return () => controller.abort();
  }, [url, sizeBytes]);

  if (error) {
    return (
      <Notice message={error} downloadUrl={downloadUrl} filename={filename} />
    );
  }
  if (text === null) {
    return (
      <p className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading…
      </p>
    );
  }
  if (kind === "markdown" && !partial) {
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
  if (kind === "delimited" && !partial) {
    return (
      <DelimitedPreview
        text={text}
        delimiter={extensionOf(filename) === "tsv" ? "\t" : ","}
      />
    );
  }
  const body =
    kind === "code" && !partial ? (
      <CodeBlock text={text} filename={filename} />
    ) : (
      <pre className="scrollbar-thin flex-1 overflow-auto whitespace-pre-wrap p-4 font-mono text-xs leading-relaxed">
        {text}
      </pre>
    );
  if (!partial) return body;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {body}
      <p className="shrink-0 border-t px-3 py-1.5 text-xs text-muted-foreground tabular-nums">
        {formatBytes(text.length)} of {formatBytes(sizeBytes)}
      </p>
    </div>
  );
}

function DelimitedPreview({
  text,
  delimiter,
}: {
  text: string;
  delimiter: string;
}) {
  const rows = parseDelimited(text, delimiter);
  const [header, ...body] = rows;
  if (!header) {
    return (
      <p className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Empty
      </p>
    );
  }
  const shown = body.slice(0, MAX_TABLE_ROWS);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="scrollbar-thin flex-1 overflow-auto">
        <table className="w-max min-w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-background">
            <tr className="border-b">
              <th className="w-10 px-2 py-1.5 text-right font-normal text-muted-foreground/60 tabular-nums" />
              {header.map((cell, column) => (
                <th
                  // Duplicate column names are common in exports, so the index
                  // is the only stable key here.
                  key={`${column}-${cell}`}
                  className="whitespace-nowrap px-2 py-1.5 text-left font-medium"
                >
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((cells, index) => (
              <tr
                key={`${index}-${cells[0] ?? ""}`}
                className="border-b border-border/40"
              >
                <td className="px-2 py-1 text-right text-muted-foreground/60 tabular-nums">
                  {index + 1}
                </td>
                {header.map((_, column) => (
                  <td
                    key={column}
                    className="max-w-[28rem] truncate px-2 py-1 tabular-nums"
                    title={cells[column]}
                  >
                    {cells[column] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="shrink-0 border-t px-3 py-1.5 text-xs text-muted-foreground tabular-nums">
        {header.length} × {body.length}
        {body.length > shown.length && ` · ${shown.length} shown`}
      </p>
    </div>
  );
}

function FontPreview({
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
  const [family, setFamily] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (sizeBytes > MAX_FONT_BYTES) return;
    const controller = new AbortController();
    // Unique per mount: two previews of different files under one family name
    // would each render whichever loaded last.
    const name = `preview-${crypto.randomUUID()}`;
    let face: FontFace | null = null;
    setFamily(null);
    setError(null);
    api
      .fetchFile(url, controller.signal)
      .then((response) => response.arrayBuffer())
      .then(async (buffer) => {
        const loaded = new FontFace(name, buffer);
        await loaded.load();
        if (controller.signal.aborted) return;
        face = loaded;
        document.fonts.add(loaded);
        setFamily(name);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(errorMessage(err));
      });
    return () => {
      controller.abort();
      if (face) document.fonts.delete(face);
    };
  }, [url, sizeBytes]);

  if (sizeBytes > MAX_FONT_BYTES) {
    return (
      <Notice
        message={`Too large to preview — ${formatBytes(sizeBytes)}`}
        downloadUrl={downloadUrl}
        filename={filename}
      />
    );
  }
  if (error) {
    return (
      <Notice message={error} downloadUrl={downloadUrl} filename={filename} />
    );
  }
  if (!family) {
    return (
      <p className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading…
      </p>
    );
  }

  return (
    <div
      className="scrollbar-thin flex-1 overflow-auto px-6 py-8"
      style={{ fontFamily: family }}
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <p className="break-words text-5xl leading-tight">
          ABCDEFGHIJKLMNOPQRSTUVWXYZ
        </p>
        <p className="break-words text-5xl leading-tight">
          abcdefghijklmnopqrstuvwxyz
        </p>
        <p className="break-words text-5xl leading-tight">
          0123456789 &amp; ! ? @ # € $ % * ( ) [ ] {"{ }"} / \ — “ ”
        </p>
        {[32, 24, 18, 14, 11].map((size) => (
          <p
            key={size}
            className="break-words leading-snug"
            style={{ fontSize: size }}
          >
            The quick brown fox jumps over the lazy dog
          </p>
        ))}
      </div>
    </div>
  );
}

/**
 * The fallback for a file whose name and stored type say nothing.
 *
 * Rather than refusing on an unrecognised extension, this reads a bounded head
 * and decides on the bytes: anything that decodes as text is shown as text, and
 * only genuinely binary content falls through to the download notice.
 */
function ProbePreview({
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
  const [head, setHead] = useState<string | null>(null);
  const [binary, setBinary] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setHead(null);
    setBinary(false);
    setError(null);
    api
      .fetchFile(url, controller.signal, PROBE_BYTES)
      .then((response) => response.arrayBuffer())
      .then((buffer) => {
        const bytes = new Uint8Array(buffer);
        const truncated = bytes.length < sizeBytes;
        if (looksBinary(bytes, truncated)) {
          setBinary(true);
          return;
        }
        // The probe already holds the whole file whenever the range covered it,
        // so only a longer file costs a second request.
        if (truncated && sizeBytes <= MAX_TEXT_BYTES) {
          return api
            .fetchFile(url, controller.signal)
            .then((response) => response.text())
            .then(setHead);
        }
        setHead(new TextDecoder("utf-8").decode(bytes));
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(errorMessage(err));
      });
    return () => controller.abort();
  }, [url, sizeBytes]);

  if (error) {
    return (
      <Notice message={error} downloadUrl={downloadUrl} filename={filename} />
    );
  }
  if (binary) {
    return (
      <Notice
        message="Binary — no preview"
        downloadUrl={downloadUrl}
        filename={filename}
      />
    );
  }
  if (head === null) {
    return (
      <p className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading…
      </p>
    );
  }
  const partial = head.length < sizeBytes;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <pre className="scrollbar-thin flex-1 overflow-auto whitespace-pre-wrap p-4 font-mono text-xs leading-relaxed">
        {head}
      </pre>
      {partial && (
        <p className="shrink-0 border-t px-3 py-1.5 text-xs text-muted-foreground tabular-nums">
          {formatBytes(head.length)} of {formatBytes(sizeBytes)}
        </p>
      )}
    </div>
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
    api
      .fetchFile(url, controller.signal)
      .then((response) => response.blob())
      .then((blob) => {
        // A blob URL is same-origin and inherits the blob's type, so trusting
        // the stored MIME would let a "report.pdf" saved as text/html execute
        // here — the kind is chosen partly from the extension. Pin the type to
        // what the viewer is actually being asked to render.
        created = URL.createObjectURL(
          new Blob([blob], { type: "application/pdf" }),
        );
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
        message={`Too large to preview — ${formatBytes(sizeBytes)}`}
        downloadUrl={downloadUrl}
        filename={filename}
      />
    );
  }
  if (error) {
    return (
      <Notice message={error} downloadUrl={downloadUrl} filename={filename} />
    );
  }
  if (!blobUrl) {
    return (
      <p className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading…
      </p>
    );
  }
  // No sandbox attribute: the blob is typed application/pdf above, so the
  // frame can only ever be parsed by the PDF viewer, never as a document. A
  // sandbox tight enough to matter also disables that viewer.
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
  if (kind === "font") {
    return (
      <FontPreview
        url={url}
        filename={filename}
        sizeBytes={sizeBytes}
        downloadUrl={downloadUrl}
      />
    );
  }
  if (
    kind === "markdown" ||
    kind === "code" ||
    kind === "text" ||
    kind === "delimited"
  ) {
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
  // Archives and binary office formats are containers: their bytes are known
  // not to be renderable, so they skip the probe that everything else gets.
  if (kind === "archive" || kind === "sheet") {
    return (
      <Notice
        message={kind === "archive" ? "Archive — no preview" : "No preview"}
        downloadUrl={downloadUrl}
        filename={filename}
      />
    );
  }
  return (
    <ProbePreview
      url={url}
      filename={filename}
      sizeBytes={sizeBytes}
      downloadUrl={downloadUrl}
    />
  );
}
