"use client";

import type {
  NotebookDetail,
  NotebookResolvedSource,
  NotebookSourcesPatch,
  StudyDocument,
} from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { EmptyState } from "@repo/ui/empty-state";
import { FormDialog } from "@repo/ui/form-dialog";
import { List, ListRow } from "@repo/ui/list";
import { Section } from "@repo/ui/section";
import { Spinner } from "@repo/ui/spinner";
import { StatusDot, type StatusTone } from "@repo/ui/status-dot";
import { Switch } from "@repo/ui/switch";
import { cn } from "@repo/ui/utils";
import { FileText, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import { type PickedSource, SourcePicker } from "./source-picker";
import { getDocument, patchNotebookSources, uploadDocument } from "./study-api";
import {
  errorMessage,
  openStudySource,
  relativeTime,
  SOURCE_KIND_ICON,
} from "./study-format";

const STATUS_TONE: Record<NotebookResolvedSource["status"], StatusTone> = {
  embedded: "good",
  pending: "warning",
  failed: "critical",
  empty: "muted",
};

const MAX_PDF_BYTES = 200 * 1024 * 1024;
const POLL_MS = 2_000;

export interface DocumentUpload {
  id: string;
  name: string;
  size: number;
  phase: "uploading" | "extracting" | "ready" | "empty" | "failed";
  pageCount?: number;
  error?: string;
}

function formatBytes(size: number): string {
  if (size < 1_048_576) return `${Math.max(1, Math.round(size / 1_024))} KB`;
  return `${(size / 1_048_576).toFixed(1)} MB`;
}

function phaseOf(document: StudyDocument): DocumentUpload["phase"] {
  return document.extraction === "pending" ? "extracting" : document.extraction;
}

/**
 * PDF uploads for one notebook: the multipart POST, then polling the
 * document until extraction settles. Byte progress is not observable through
 * the admin transport (fetch, no upload events), so uploading is one phase.
 */
export function useDocumentUploads(notebookId: string, onSettled: () => void) {
  const { client } = useAdmin();
  const [uploads, setUploads] = useState<DocumentUpload[]>([]);
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
    };
  }, []);

  const patch = (id: string, next: Partial<DocumentUpload>) =>
    setUploads((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, ...next } : entry)),
    );

  const poll = useCallback(
    (localId: string, documentId: string) => {
      const timer = setTimeout(async () => {
        timers.current.delete(timer);
        try {
          const document = await getDocument(client, documentId);
          const phase = phaseOf(document);
          patch(localId, {
            phase,
            pageCount: document.pageCount,
            error: document.extractionError,
          });
          if (phase === "extracting") poll(localId, documentId);
          else onSettledRef.current();
        } catch {
          poll(localId, documentId);
        }
      }, POLL_MS);
      timers.current.add(timer);
    },
    [client],
  );

  const start = useCallback(
    (files: File[]) => {
      for (const file of files) {
        const localId = `${file.name}-${file.size}-${Date.now()}`;
        const isPdf =
          file.type === "application/pdf" ||
          file.name.toLowerCase().endsWith(".pdf");
        if (!isPdf || file.size > MAX_PDF_BYTES) {
          toast.error(
            isPdf ? `${file.name} is over 200 MB` : `${file.name} is not a PDF`,
          );
          continue;
        }
        setUploads((current) => [
          ...current,
          { id: localId, name: file.name, size: file.size, phase: "uploading" },
        ]);
        uploadDocument(client, {
          file,
          title: file.name.replace(/\.pdf$/i, ""),
          notebookId,
        })
          .then((document) => {
            const phase = phaseOf(document);
            patch(localId, { phase, pageCount: document.pageCount });
            onSettledRef.current();
            if (phase === "extracting") poll(localId, document._id);
          })
          .catch((error: unknown) => {
            patch(localId, {
              phase: "failed",
              error: errorMessage(error, "Upload failed"),
            });
          });
      }
    },
    [client, notebookId, poll],
  );

  const dismiss = (id: string) =>
    setUploads((current) => current.filter((entry) => entry.id !== id));

  return { uploads, start, dismiss };
}

function UploadRow({
  upload,
  onDismiss,
}: {
  upload: DocumentUpload;
  onDismiss: () => void;
}) {
  const working = upload.phase === "uploading" || upload.phase === "extracting";
  const tone: StatusTone =
    upload.phase === "ready"
      ? "good"
      : upload.phase === "failed"
        ? "critical"
        : upload.phase === "empty"
          ? "muted"
          : "warning";
  return (
    <ListRow
      leading={<FileText />}
      title={upload.name}
      description={upload.error}
      meta={
        <>
          <span>{formatBytes(upload.size)}</span>
          {upload.pageCount ? <span>{upload.pageCount} pp.</span> : null}
          <span className="flex w-24 items-center justify-end gap-1.5">
            {working ? (
              <Spinner className="size-3" />
            ) : (
              <StatusDot tone={tone} label={upload.phase} />
            )}
            {upload.phase}
          </span>
        </>
      }
      trailing={
        working ? (
          <span className="size-7" />
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Dismiss"
            onClick={onDismiss}
          >
            <X />
          </Button>
        )
      }
    />
  );
}

export function AddSourcesDialog({
  open,
  onOpenChange,
  detail,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: NotebookDetail;
  onSaved: (detail: NotebookDetail) => void;
}) {
  const { client } = useAdmin();
  const [selected, setSelected] = useState<PickedSource[]>([]);
  const [pending, setPending] = useState(false);
  const existing = new Set(detail.sources.map((source) => source.sourceKey));

  const submit = async () => {
    if (selected.length === 0) return;
    setPending(true);
    try {
      onSaved(
        await patchNotebookSources(client, detail.notebook._id, {
          add: selected.map((source) => ({ kind: source.kind, id: source.id })),
        }),
      );
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error, "Failed to add sources"));
    } finally {
      setPending(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add sources"
      onSubmit={submit}
      submitLabel={selected.length > 0 ? `Add ${selected.length}` : "Add"}
      submitDisabled={selected.length === 0}
      pending={pending}
    >
      <SourcePicker
        selected={selected}
        onChange={setSelected}
        exclude={existing}
      />
    </FormDialog>
  );
}

function SourceRow({
  source,
  busy,
  onPatch,
  onOpen,
}: {
  source: NotebookResolvedSource;
  busy: boolean;
  onPatch: (patch: NotebookSourcesPatch) => void;
  onOpen: () => void;
}) {
  return (
    <ListRow
      onClick={onOpen}
      className={cn(source.excluded && "opacity-55")}
      leading={SOURCE_KIND_ICON[source.kind]}
      title={source.title || "Untitled"}
      meta={
        <>
          <span className="hidden w-16 sm:inline">
            {source.origin === "course" ? "Course" : "Added"}
          </span>
          <span className="w-16 text-right">
            {source.chunkCount > 0 ? `${source.chunkCount} ch.` : "—"}
          </span>
          <span className="flex w-5 justify-center">
            <StatusDot
              tone={STATUS_TONE[source.status]}
              label={source.status}
            />
          </span>
          <span className="hidden w-16 text-right sm:inline">
            {relativeTime(source.updatedAt)}
          </span>
        </>
      }
      trailing={
        source.origin === "course" ? (
          <span className="flex w-7 justify-center">
            <Switch
              checked={!source.excluded}
              disabled={busy}
              aria-label={source.excluded ? "Include" : "Exclude"}
              onCheckedChange={(include) =>
                onPatch(
                  include
                    ? { include: [source.sourceKey] }
                    : { exclude: [source.sourceKey] },
                )
              }
            />
          </span>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Remove"
            disabled={busy}
            className="text-muted-foreground"
            onClick={() => onPatch({ remove: [source.sourceKey] })}
          >
            <X />
          </Button>
        )
      }
    />
  );
}

export function NotebookSources({
  detail,
  uploads,
  onDismissUpload,
  onChange,
}: {
  detail: NotebookDetail;
  uploads: DocumentUpload[];
  onDismissUpload: (id: string) => void;
  onChange: (detail: NotebookDetail) => void;
}) {
  const admin = useAdmin();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const patch = async (key: string, body: NotebookSourcesPatch) => {
    setBusyKey(key);
    try {
      onChange(
        await patchNotebookSources(admin.client, detail.notebook._id, body),
      );
    } catch (error) {
      toast.error(errorMessage(error, "Failed to update sources"));
    } finally {
      setBusyKey(null);
    }
  };

  const course = detail.sources.filter((source) => source.origin === "course");
  const explicit = detail.sources.filter(
    (source) => source.origin === "explicit",
  );
  const included = detail.sources.filter((source) => !source.excluded);
  const chunks = included.reduce((sum, source) => sum + source.chunkCount, 0);
  const pending = included.filter(
    (source) => source.status === "pending",
  ).length;

  const rows = (sources: NotebookResolvedSource[]) => (
    <List divided>
      {sources.map((source) => (
        <SourceRow
          key={source.sourceKey}
          source={source}
          busy={busyKey === source.sourceKey}
          onPatch={(body) => void patch(source.sourceKey, body)}
          onOpen={() => void openStudySource(admin, source)}
        />
      ))}
    </List>
  );

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs tabular-nums text-muted-foreground">
        <span>
          <span className="text-accent-strong">{included.length}</span> sources
        </span>
        <span>
          <span className="text-accent-strong">{chunks}</span> chunks
        </span>
        {pending > 0 ? <span>{pending} indexing</span> : null}
        {detail.notebook.excluded.length > 0 ? (
          <span>{detail.notebook.excluded.length} excluded</span>
        ) : null}
      </div>
      {uploads.length > 0 ? (
        <Section title="Uploads" count={uploads.length}>
          <List divided>
            {uploads.map((upload) => (
              <UploadRow
                key={upload.id}
                upload={upload}
                onDismiss={() => onDismissUpload(upload.id)}
              />
            ))}
          </List>
        </Section>
      ) : null}
      {detail.sources.length === 0 ? (
        <EmptyState icon={<FileText />} label="No sources" />
      ) : (
        <>
          {course.length > 0 ? (
            <Section title="Course" count={course.length}>
              {rows(course)}
            </Section>
          ) : null}
          {explicit.length > 0 ? (
            <Section title="Added" count={explicit.length}>
              {rows(explicit)}
            </Section>
          ) : null}
        </>
      )}
    </div>
  );
}
