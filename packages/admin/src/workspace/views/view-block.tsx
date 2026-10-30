"use client";

import {
  type BlockOf,
  VIEW_LIMIT_MAX,
  VIEW_SOURCES,
  type ViewConfig,
  type ViewFilter,
  type ViewQueryResult,
  type ViewRow,
  type ViewSourceId,
  viewDateField,
  viewQueryResultSchema,
} from "@repo/schemas";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/popover";
import { Skeleton } from "@repo/ui/skeleton";
import { cn } from "@repo/ui/utils";
import { format, startOfMonth } from "date-fns";
import { ArrowUpRight, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdmin } from "../../provider";
import type { ModuleId } from "../modules";
import { recordHref } from "../records";
import type { WorkspaceNav } from "../refs";
import { useWorkspaceNav } from "../use-workspace-nav";
import { ViewConfigEditor } from "./config";
import {
  BoardLayout,
  CalendarLayout,
  GalleryLayout,
  type LayoutProps,
  ListLayout,
  monthWindow,
  TableLayout,
} from "./layouts";

const LABEL =
  "text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground";

const SOURCE_MODULE: Record<ViewSourceId, ModuleId> = {
  "kanban-cards": "kanban",
  "calendar-events": "calendar",
  notes: "notes",
  "finance-entries": "finance",
  "course-assignments": "courses",
  people: "people",
  triage: "triage",
  "agent-tasks": "agent-tasks",
  papers: "papers",
  "voice-notes": "voice-notes",
};

/** Where a row opens: its entity's route, else the module (a finance row its entry). */
function rowHrefFor(
  nav: WorkspaceNav,
  source: ViewSourceId,
): (row: ViewRow) => string | undefined {
  return (row) => {
    if (row.ref) return recordHref(nav, row.ref);
    if (source === "finance-entries") return nav.routes.finance.entry(row.id);
    return nav.moduleHref(SOURCE_MODULE[source]);
  };
}

export function viewConfigOf(block: BlockOf<"view">): ViewConfig {
  const { id: _id, type: _type, title: _title, ...config } = block;
  return config;
}

type QueryState = {
  result: ViewQueryResult | null;
  rows: ViewRow[];
  error: string | null;
  loading: boolean;
};

/** One view's rows: the first page on every config change, more on demand. */
export function useViewQuery(
  config: ViewConfig,
  extra: ViewFilter[],
  limit?: number,
) {
  const { client } = useAdmin();
  const key = JSON.stringify({ config, extra, limit });
  const [state, setState] = useState<QueryState>({
    result: null,
    rows: [],
    error: null,
    loading: true,
  });

  const fetchPage = useCallback(
    async (cursor?: string) => {
      const view: ViewConfig = {
        ...config,
        filters: [...config.filters, ...extra],
      };
      return viewQueryResultSchema.parse(
        await client.post("workspace/views/query", {
          view,
          today: format(new Date(), "yyyy-MM-dd"),
          ...(cursor ? { cursor } : {}),
          ...(limit ? { limit } : {}),
        }),
      );
    },
    // `key` stands for config, extra and limit, which are rebuilt each render.
    [client, key],
  );

  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetchPage()
      .then((result) => {
        if (live)
          setState({ result, rows: result.rows, error: null, loading: false });
      })
      .catch((error: Error) => {
        if (live)
          setState({
            result: null,
            rows: [],
            error: error.message,
            loading: false,
          });
      });
    return () => {
      live = false;
    };
  }, [fetchPage]);

  const loadMore = useCallback(async () => {
    const cursor = state.result?.nextCursor;
    if (!cursor) return;
    setState((s) => ({ ...s, loading: true }));
    try {
      const next = await fetchPage(cursor);
      setState((s) => ({
        result: s.result ? { ...s.result, nextCursor: next.nextCursor } : next,
        rows: [...s.rows, ...next.rows],
        error: null,
        loading: false,
      }));
    } catch (error) {
      setState((s) => ({
        ...s,
        loading: false,
        error: error instanceof Error ? error.message : "Failed",
      }));
    }
  }, [fetchPage, state.result?.nextCursor]);

  return { ...state, loadMore };
}

export function ViewBlock({
  block,
  editable,
  selected,
  onChange,
}: {
  block: BlockOf<"view">;
  editable: boolean;
  selected: boolean;
  onChange: (block: BlockOf<"view">) => void;
}) {
  const nav = useWorkspaceNav();
  const config = useMemo(() => viewConfigOf(block), [block]);
  const descriptor = VIEW_SOURCES[config.source];
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const dateField =
    config.layout === "calendar" ? viewDateField(descriptor, config) : null;
  const extra = useMemo<ViewFilter[]>(() => {
    if (!dateField) return [];
    const { from, to } = monthWindow(month);
    return [
      { field: dateField, op: "on_or_after", value: from },
      { field: dateField, op: "on_or_before", value: to },
    ];
  }, [dateField, month]);
  const query = useViewQuery(
    config,
    extra,
    dateField ? VIEW_LIMIT_MAX : undefined,
  );
  const [configOpen, setConfigOpen] = useState(false);

  const fields = useMemo(() => {
    const shown = (config.fields ?? [...descriptor.defaultFields]).filter(
      (f) => f in descriptor.fields,
    );
    return shown.includes(descriptor.titleField)
      ? [
          descriptor.titleField,
          ...shown.filter((f) => f !== descriptor.titleField),
        ]
      : [descriptor.titleField, ...shown];
  }, [config.fields, descriptor]);

  const rowHref = useMemo(
    () => rowHrefFor(nav, config.source),
    [nav, config.source],
  );
  const label = block.title ?? descriptor.label;
  const href = nav.moduleHref(SOURCE_MODULE[config.source]);

  let body: React.ReactNode;
  if (query.error) {
    body = <span className="text-xs text-destructive">{query.error}</span>;
  } else if (!query.result) {
    body = (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  } else {
    const props: LayoutProps = {
      descriptor,
      config,
      result: query.result,
      rows: query.rows,
      fields,
      rowHref,
    };
    if (query.result.total === 0 && config.layout !== "calendar") {
      body = <span className="text-xs text-muted-foreground">—</span>;
    } else if (config.layout === "list") body = <ListLayout {...props} />;
    else if (config.layout === "board") body = <BoardLayout {...props} />;
    else if (config.layout === "gallery") body = <GalleryLayout {...props} />;
    else if (config.layout === "calendar") {
      body = <CalendarLayout {...props} month={month} onMonth={setMonth} />;
    } else body = <TableLayout {...props} />;
  }

  return (
    <div
      data-view={config.source}
      className="@container flex flex-col gap-3 py-1"
    >
      <div className="flex min-h-6 items-center gap-3">
        {editable && selected ? (
          <input
            defaultValue={label}
            placeholder={descriptor.label}
            onBlur={(event) => {
              const value = event.currentTarget.value.trim();
              const title =
                value === descriptor.label || value === "" ? undefined : value;
              if (title !== block.title) onChange({ ...block, title });
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            className={cn(
              LABEL,
              "w-48 min-w-0 bg-transparent outline-none focus:text-accent-strong",
            )}
          />
        ) : href ? (
          <Link
            href={href}
            className={cn(
              LABEL,
              "group/label flex shrink-0 items-center gap-1 hover:text-accent-strong",
            )}
          >
            {label}
            <ArrowUpRight className="size-3 opacity-0 transition-opacity group-hover/label:opacity-100" />
          </Link>
        ) : (
          <span className={cn(LABEL, "shrink-0")}>{label}</span>
        )}
        {query.result ? (
          <span
            data-view-total=""
            className="text-xs tabular-nums text-muted-foreground"
          >
            {query.result.total}
            {query.result.truncated ? "+" : ""}
          </span>
        ) : null}
        <div className="h-px flex-1 bg-border" />
        {editable ? (
          <Popover open={configOpen} onOpenChange={setConfigOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="View settings"
                className="rounded p-0.5 text-muted-foreground hover:bg-surface hover:text-accent-strong"
              >
                <SlidersHorizontal className="size-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="max-h-[70vh] w-[26rem] overflow-y-auto"
            >
              <ViewConfigEditor
                config={config}
                options={query.result?.options ?? {}}
                onChange={(next) =>
                  onChange({
                    id: block.id,
                    type: "view",
                    ...(block.title !== undefined
                      ? { title: block.title }
                      : {}),
                    ...next,
                  })
                }
              />
            </PopoverContent>
          </Popover>
        ) : null}
      </div>
      {body}
      {query.result?.nextCursor && config.layout !== "calendar" ? (
        <button
          type="button"
          disabled={query.loading}
          onClick={() => void query.loadMore()}
          className="w-fit text-xs text-muted-foreground hover:text-accent-strong"
        >
          {query.loading
            ? "Loading"
            : `More (${query.result.total - query.rows.length})`}
        </button>
      ) : null}
    </div>
  );
}
