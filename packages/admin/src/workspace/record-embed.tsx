"use client";

import {
  type BlockOf,
  ENTITY_KINDS,
  type EntityKind,
  parseEntityRef,
  type RecordEmbedMode,
  type RecordSummary,
} from "@repo/schemas";
import { Properties, Property } from "@repo/ui/properties";
import { Skeleton } from "@repo/ui/skeleton";
import { cn } from "@repo/ui/utils";
import { ArrowUpRight, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAdmin } from "../provider";
import { PageIcon } from "./page-icon";
import {
  RECORD_KINDS,
  type RecordState,
  recordHref,
  searchRecords,
  useRecord,
} from "./records";
import { useWorkspaceNav } from "./use-workspace-nav";

const LABEL =
  "text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground";

function KindIcon({
  record,
  kind,
  className,
}: {
  record?: RecordSummary;
  kind: EntityKind;
  className?: string;
}) {
  if (kind === "page") {
    return <PageIcon icon={record?.icon ?? null} className={className} />;
  }
  const Icon = RECORD_KINDS[kind].icon;
  return <Icon className={cn("text-muted-foreground", className)} />;
}

/** A record that is gone: its kind's glyph and a dash. */
export function MissingRecord({ kind }: { kind: EntityKind | null }) {
  return (
    <span
      data-record-missing=""
      className="flex items-center gap-2 py-1 text-sm text-muted-foreground/70"
    >
      {kind ? <KindIcon kind={kind} className="size-4" /> : null}—
    </span>
  );
}

/** Compact: icon, title, subtitle and a few key fields on one row; `ruled` among other rows. */
export function RecordCard({
  record,
  ruled = false,
}: {
  record: RecordSummary;
  ruled?: boolean;
}) {
  const nav = useWorkspaceNav();
  const href = recordHref(nav, record.ref);
  const body = (
    <>
      <KindIcon
        record={record}
        kind={record.kind}
        className="mt-0.5 size-4 shrink-0"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-sm font-medium text-accent-strong">
            {record.title || "Untitled"}
          </span>
          {record.subtitle ? (
            <span className="truncate text-xs text-muted-foreground">
              {record.subtitle}
            </span>
          ) : null}
        </div>
        {record.fields.length > 0 ? (
          <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground tabular-nums">
            {record.fields.slice(0, 3).map((field) => (
              <span key={field.label}>
                <span className="text-muted-foreground/60">{field.label}</span>{" "}
                {field.value}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {href ? (
        <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/record:opacity-100" />
      ) : null}
    </>
  );
  const className = cn(
    "group/record flex items-start gap-3 py-2 hover:bg-surface/70",
    ruled ? "border-b" : "-mx-2 rounded-sm px-2",
  );
  return href ? (
    <Link href={href} data-record={record.ref} className={className}>
      {body}
    </Link>
  ) : (
    <div data-record={record.ref} className={className}>
      {body}
    </div>
  );
}

/** Full mode for a kind with no module component: every field. */
function RecordSheet({ record }: { record: RecordSummary }) {
  const nav = useWorkspaceNav();
  const href = recordHref(nav, record.ref);
  return (
    <div data-record={record.ref} className="flex flex-col gap-2 py-1">
      <div className="flex items-center gap-2">
        <KindIcon record={record} kind={record.kind} className="size-4" />
        {href ? (
          <Link
            href={href}
            className="text-base font-semibold text-accent-strong hover:underline"
          >
            {record.title || "Untitled"}
          </Link>
        ) : (
          <span className="text-base font-semibold text-accent-strong">
            {record.title || "Untitled"}
          </span>
        )}
        {record.subtitle ? (
          <span className="text-xs text-muted-foreground">
            {record.subtitle}
          </span>
        ) : null}
      </div>
      {record.fields.length > 0 ? (
        <Properties>
          {record.fields.map((field) => (
            <Property key={field.label} label={field.label}>
              {field.value}
            </Property>
          ))}
        </Properties>
      ) : null}
    </div>
  );
}

export function RecordView({
  state,
  kind,
  id,
  mode,
  editable,
}: {
  state: RecordState;
  kind: EntityKind;
  id: string;
  mode: RecordEmbedMode;
  editable: boolean;
}) {
  if (state.status === "missing") return <MissingRecord kind={kind} />;
  const def = RECORD_KINDS[kind];
  if (mode === "full" && def.Full) {
    const Full = def.Full;
    return (
      <div data-record-full={`${kind}:${id}`} className="flex flex-col gap-2">
        {state.status === "ready" && kind !== "page" ? (
          <RecordCard record={state.record} />
        ) : null}
        <Full id={id} editable={editable} />
      </div>
    );
  }
  if (state.status === "loading") {
    return (
      <div className="flex items-center gap-3 py-2">
        <Skeleton className="size-4" />
        <Skeleton className="h-4 w-48" />
      </div>
    );
  }
  return mode === "full" ? (
    <RecordSheet record={state.record} />
  ) : (
    <RecordCard record={state.record} />
  );
}

// --- the picker -------------------------------------------------------------------

export type PickMode = RecordEmbedMode | "mention";

const MODES: { value: PickMode; label: string }[] = [
  { value: "mention", label: "Mention" },
  { value: "card", label: "Card" },
  { value: "full", label: "Full" },
];

/** Searches records of every kind; picking one embeds it in the chosen mode. */
export function RecordPicker({
  onPick,
  focus = false,
}: {
  onPick: (record: RecordSummary, mode: PickMode) => void;
  /** Takes focus when this turns true: the block was just inserted or picked. */
  focus?: boolean;
}) {
  const { client } = useAdmin();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focus) input.current?.focus({ preventScroll: true });
  }, [focus]);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<PickMode>("card");
  const [kind, setKind] = useState<EntityKind | "all">("all");
  const [results, setResults] = useState<RecordSummary[] | null>(null);
  const [active, setActive] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    const mine = ++seq.current;
    const timer = setTimeout(() => {
      searchRecords(client, query, kind === "all" ? ENTITY_KINDS : [kind])
        .then((records) => {
          if (seq.current === mine) {
            setResults(records);
            setActive(0);
          }
        })
        .catch(() => {
          if (seq.current === mine) setResults([]);
        });
    }, 150);
    return () => clearTimeout(timer);
  }, [client, query, kind]);

  const pick = (record: RecordSummary | undefined) => {
    if (record) onPick(record, mode);
  };

  return (
    <div data-record-picker="" className="flex flex-col gap-1 py-2">
      <div className="flex items-center gap-2">
        <Search className="size-4 text-muted-foreground" />
        <input
          ref={input}
          value={query}
          placeholder="Search"
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            const count = results?.length ?? 0;
            if (event.key === "ArrowDown" && count > 0) {
              event.preventDefault();
              setActive((i) => (i + 1) % count);
            } else if (event.key === "ArrowUp" && count > 0) {
              event.preventDefault();
              setActive((i) => (i - 1 + count) % count);
            } else if (event.key === "Enter") {
              event.preventDefault();
              pick(results?.[active]);
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
        />
        <select
          aria-label="Kind"
          value={kind}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setKind(ENTITY_KINDS.find((k) => k === value) ?? "all");
          }}
          className="bg-transparent text-xs text-muted-foreground outline-none"
        >
          <option value="all">All</option>
          {ENTITY_KINDS.map((k) => (
            <option key={k} value={k}>
              {RECORD_KINDS[k].label}
            </option>
          ))}
        </select>
        <div role="radiogroup" aria-label="Mode" className="flex gap-0.5">
          {MODES.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={mode === option.value}
              onClick={() => setMode(option.value)}
              className={cn(
                "rounded px-1.5 py-0.5 text-xs",
                mode === option.value
                  ? "bg-surface text-accent-strong"
                  : "text-muted-foreground hover:text-accent-strong",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      {results === null ? null : results.length === 0 ? (
        <span className="pl-6 text-xs text-muted-foreground">—</span>
      ) : (
        <div role="listbox" className="flex max-h-64 flex-col overflow-y-auto">
          {results.map((record, index) => (
            <button
              key={record.ref}
              type="button"
              role="option"
              aria-selected={index === active}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                pick(record);
              }}
              className={cn(
                "flex items-center gap-2 rounded-sm px-1 py-1 text-left text-sm",
                index === active && "bg-surface",
              )}
            >
              <KindIcon
                record={record}
                kind={record.kind}
                className="size-4 shrink-0"
              />
              <span className="min-w-0 truncate">
                {record.title || "Untitled"}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {record.subtitle}
              </span>
              <span className={cn(LABEL, "shrink-0")}>
                {RECORD_KINDS[record.kind].label}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// --- the block -----------------------------------------------------------------

export function RecordBlock({
  block,
  editable,
  selected,
  onChange,
  onMention,
}: {
  block: BlockOf<"record">;
  editable: boolean;
  selected: boolean;
  onChange: (block: BlockOf<"record">) => void;
  /** Replaces the block with a paragraph mentioning the record. */
  onMention: (record: RecordSummary) => void;
}) {
  const parsed = useMemo(() => parseEntityRef(block.ref), [block.ref]);
  const state = useRecord(parsed ? block.ref : null);
  if (!parsed) {
    if (!editable) return block.ref ? <MissingRecord kind={null} /> : null;
    return (
      <RecordPicker
        focus={selected}
        onPick={(record, mode) =>
          mode === "mention"
            ? onMention(record)
            : onChange({ ...block, ref: record.ref, mode })
        }
      />
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <RecordView
        state={state}
        kind={parsed.kind}
        id={parsed.id}
        mode={block.mode}
        editable={editable}
      />
      {editable && selected ? (
        <div className="flex gap-0.5 text-xs">
          {(["card", "full"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={block.mode === mode}
              onClick={() => onChange({ ...block, mode })}
              className={cn(
                "rounded px-1.5 py-0.5",
                block.mode === mode
                  ? "bg-surface text-accent-strong"
                  : "text-muted-foreground hover:text-accent-strong",
              )}
            >
              {mode === "card" ? "Card" : "Full"}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onChange({ ...block, ref: "" })}
            className="rounded px-1.5 py-0.5 text-muted-foreground hover:text-accent-strong"
          >
            Replace
          </button>
        </div>
      ) : null}
    </div>
  );
}
