"use client";

import { useRef, useState, type DragEvent } from "react";
import useSWR from "swr";
import { Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/components/shared";
import {
  documentExtensions,
  formatBytes,
  type DocumentMeta,
} from "@/lib/documents/types";
import { symbolPattern } from "@/lib/universes";
import { ago, useNow } from "./format";
import { UploadList } from "./upload-list";
import { documentsKey, useDocumentUpload } from "./use-document-upload";

type Library = {
  documents: DocumentMeta[];
  demo: boolean;
  limits: { uploadBytes: number; perUser: number };
};

function parseSymbols(text: string) {
  const symbols = [
    ...new Set(
      text
        .split(/[\s,;]+/)
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
  return {
    symbols,
    invalid: symbols.filter((symbol) => !symbolPattern.test(symbol)),
  };
}

export function DocumentsPanel({ className }: { className?: string }) {
  const now = useNow();
  const { data, error, isLoading, mutate } = useSWR<Library>(documentsKey, api);
  const { items, upload, dismiss } = useDocumentUpload();
  const [symbols, setSymbols] = useState("");
  const [failure, setFailure] = useState("");
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const demo = data?.demo ?? false;

  function start(files: FileList | File[]) {
    const parsed = parseSymbols(symbols);
    if (parsed.invalid.length) {
      setFailure(`Not a valid symbol: ${parsed.invalid.join(", ")}`);
      return;
    }
    setFailure("");
    void upload(files, parsed.symbols.slice(0, 12).join(" "));
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (!demo && event.dataTransfer.files.length) start(event.dataTransfer.files);
  }

  async function remove(id: string) {
    setFailure("");
    const previous = data;
    await mutate(
      (current) =>
        current && {
          ...current,
          documents: current.documents.filter((doc) => doc.id !== id),
        },
      { revalidate: false },
    );
    try {
      await api<{ ok: true }>(`${documentsKey}/${id}`, { method: "DELETE" });
    } catch (reason) {
      await mutate(previous, { revalidate: false });
      setFailure(
        reason instanceof Error ? reason.message : "Could not delete document.",
      );
    }
  }

  const documents = data?.documents ?? [];
  return (
    <section
      className={["section documents-panel", className].filter(Boolean).join(" ")}
      aria-label="Documents"
      data-dragging={dragging || undefined}
      onDragOver={(event) => {
        if (demo || !event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node && event.currentTarget.contains(next)))
          setDragging(false);
      }}
      onDrop={onDrop}
    >
      <header className="section-head">
        <div>
          <h2>Documents</h2>
          <p>
            Research, decks and memos the assistant can search and read
            {data ? ` · ${documents.length}/${data.limits.perUser}` : ""}
          </p>
        </div>
        <div className="row-actions">
          <Button
            variant="outline"
            size="sm"
            disabled={demo}
            onClick={() => picker.current?.click()}
          >
            <Upload /> Upload
          </Button>
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            accept={documentExtensions}
            onChange={(event) => {
              if (event.target.files?.length) start(event.target.files);
              event.target.value = "";
            }}
          />
        </div>
      </header>
      <div className="section-body">
        {demo ? (
          <p className="chat-quiet">Documents are not available in the demo.</p>
        ) : (
          <div className="doc-options">
            <input
              className="memory-symbols-input"
              value={symbols}
              onChange={(event) => setSymbols(event.target.value)}
              placeholder="Tag next uploads with symbols, e.g. ASML.AS NVDA"
              aria-label="Symbols for the next uploads"
            />
            <span className="meta">
              PDF, DOCX, TXT, MD, CSV, HTML · up to{" "}
              {formatBytes(data?.limits.uploadBytes ?? 25 * 1024 * 1024)} · text
              PDFs only, no OCR
            </span>
          </div>
        )}
        <UploadList items={items} onDismiss={dismiss} />
        {failure || error ? (
          <p className="chat-tool-error" role="alert">
            {failure || (error instanceof Error ? error.message : "")}
          </p>
        ) : null}
        {isLoading && !data ? (
          <p className="chat-quiet">Loading documents…</p>
        ) : !documents.length && !demo ? (
          <div className="empty">
            <strong>No documents yet</strong>
            <div>
              Drop a broker note, a company deck or your own memo here, or attach
              it in the assistant. Then ask about it by name.
            </div>
          </div>
        ) : (
          <ul className="ruled-list flush-top">
            {documents.map((doc) => (
              <li key={doc.id} className="memory-item">
                <div className="memory-body">
                  <p className="doc-name" title={doc.name}>
                    {doc.name}
                  </p>
                  <span className="meta">
                    {doc.symbols.map((symbol) => (
                      <span key={symbol} className="tag">
                        {symbol}
                      </span>
                    ))}
                    {doc.kind.toUpperCase()} · {formatBytes(doc.size)}
                    {doc.pages ? ` · ${doc.pages} pp` : ""} ·{" "}
                    {ago(doc.uploadedAt, now)}
                  </span>
                </div>
                <div className="memory-actions">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Delete ${doc.name}`}
                    onClick={() => void remove(doc.id)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
