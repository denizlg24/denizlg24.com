"use client";

import {
  type KnowledgeSourceKey,
  type KnowledgeSourceKind,
  knowledgeSourceKey,
  type StudyDocument,
} from "@repo/schemas";
import { Checkbox } from "@repo/ui/checkbox";
import { Skeleton } from "@repo/ui/skeleton";
import { FilterTabs, SearchField } from "@repo/ui/toolbar";
import { cn } from "@repo/ui/utils";
import { useEffect, useMemo, useState } from "react";
import { useAdmin } from "../provider";
import { listDocuments, searchRecords } from "./study-api";
import { relativeTime, SOURCE_KIND_ICON } from "./study-format";

export interface PickedSource {
  kind: KnowledgeSourceKind;
  id: string;
  title: string;
}

type KindFilter = "all" | KnowledgeSourceKind;

interface Candidate extends PickedSource {
  key: KnowledgeSourceKey;
  meta?: string;
}

/**
 * Multi-select over notes, voice notes and uploaded PDFs. Notes and voice
 * notes come from the workspace record search (titles); documents are listed
 * whole and filtered here.
 */
export function SourcePicker({
  selected,
  onChange,
  exclude,
}: {
  selected: PickedSource[];
  onChange: (next: PickedSource[]) => void;
  /** Keys already in the notebook; shown checked and disabled. */
  exclude?: ReadonlySet<string>;
}) {
  const { client } = useAdmin();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [records, setRecords] = useState<Candidate[] | null>(null);
  const [documents, setDocuments] = useState<StudyDocument[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    listDocuments(client, { signal: controller.signal })
      .then(setDocuments)
      .catch(() => {
        if (!controller.signal.aborted) setDocuments([]);
      });
    return () => controller.abort();
  }, [client]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchRecords(client, query.trim(), ["note", "voice-note"], {
        signal: controller.signal,
      })
        .then((found) => {
          setRecords(
            found.flatMap((record): Candidate[] => {
              const recordKind: KnowledgeSourceKind | null =
                record.kind === "note"
                  ? "note"
                  : record.kind === "voice-note"
                    ? "voice-note"
                    : null;
              if (!recordKind) return [];
              return [
                {
                  kind: recordKind,
                  id: record.id,
                  title: record.title || "Untitled",
                  key: knowledgeSourceKey(recordKind, record.id),
                  meta: record.subtitle ?? relativeTime(record.updatedAt),
                },
              ];
            }),
          );
        })
        .catch(() => {
          if (!controller.signal.aborted) setRecords([]);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [client, query]);

  const candidates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const docs: Candidate[] = (documents ?? [])
      .filter((doc) => !needle || doc.title.toLowerCase().includes(needle))
      .map((doc) => ({
        kind: "document",
        id: doc._id,
        title: doc.title,
        key: knowledgeSourceKey("document", doc._id),
        meta: doc.pageCount ? `${doc.pageCount} pp.` : doc.extraction,
      }));
    const all = [...(records ?? []), ...docs];
    return kind === "all" ? all : all.filter((entry) => entry.kind === kind);
  }, [documents, kind, query, records]);

  const selectedKeys = useMemo(
    () =>
      new Set(
        selected.map((entry) => knowledgeSourceKey(entry.kind, entry.id)),
      ),
    [selected],
  );

  const toggle = (candidate: Candidate) => {
    if (selectedKeys.has(candidate.key)) {
      onChange(
        selected.filter(
          (entry) => knowledgeSourceKey(entry.kind, entry.id) !== candidate.key,
        ),
      );
    } else {
      onChange([
        ...selected,
        { kind: candidate.kind, id: candidate.id, title: candidate.title },
      ]);
    }
  };

  const loading = records === null || documents === null;

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search notes, voice notes, PDFs"
          className="flex-1"
        />
        <FilterTabs
          value={kind}
          onChange={setKind}
          options={[
            { value: "all", label: "All" },
            { value: "note", label: "Notes" },
            { value: "voice-note", label: "Voice" },
            { value: "document", label: "PDFs" },
          ]}
        />
      </div>
      <div className="flex max-h-80 min-h-40 flex-col overflow-y-auto rounded-md">
        {loading ? (
          Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="flex items-center gap-3 px-2 py-2">
              <Skeleton className="size-4" />
              <Skeleton className="h-3.5 w-1/2" />
            </div>
          ))
        ) : candidates.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            0 results
          </p>
        ) : (
          candidates.map((candidate) => {
            const already = exclude?.has(candidate.key) ?? false;
            const checked = already || selectedKeys.has(candidate.key);
            return (
              <label
                key={candidate.key}
                className={cn(
                  "flex min-h-9 cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-surface/70",
                  already && "cursor-default opacity-60 hover:bg-transparent",
                )}
              >
                <Checkbox
                  checked={checked}
                  disabled={already}
                  onCheckedChange={() => toggle(candidate)}
                />
                <span className="flex shrink-0 text-muted-foreground [&_svg]:size-4">
                  {SOURCE_KIND_ICON[candidate.kind]}
                </span>
                <span className="min-w-0 flex-1 truncate text-accent-strong">
                  {candidate.title}
                </span>
                {candidate.meta ? (
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {candidate.meta}
                  </span>
                ) : null}
              </label>
            );
          })
        )}
      </div>
      {selected.length > 0 ? (
        <p className="text-xs tabular-nums text-muted-foreground">
          {selected.length} selected
        </p>
      ) : null}
    </div>
  );
}
