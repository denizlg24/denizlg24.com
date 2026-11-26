"use client";

import {
  type BlockOf,
  VIEW_LIMIT_MAX,
  VIEW_SOURCES,
  type ViewConfig,
  type ViewFilter,
  type ViewRow,
  type ViewSourceId,
  viewDateField,
  viewGroupField,
  viewQueryResultSchema,
} from "@repo/schemas";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/popover";
import { Skeleton } from "@repo/ui/skeleton";
import { cn } from "@repo/ui/utils";
import { format, startOfMonth } from "date-fns";
import { ArrowUpRight, Check, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";
import type { AdminClient } from "../../client";
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
import {
  getViewQueryEntry,
  optimisticallyRemoveViewRow,
  setViewQueryError,
  setViewQueryLoading,
  setViewQueryResult,
  subscribeViewQuery,
  viewQueryIsFresh,
} from "./query-cache";

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
  "blog-posts": "blog",
  projects: "projects",
  timeline: "timeline",
  contacts: "contacts",
  emails: "inbox",
  "finance-accounts": "finance",
  "finance-rules": "finance",
  journal: "journal",
  spreadsheets: "spreadsheets",
  resources: "resources",
  "work-sessions": "hours",
  timetable: "timetable",
};

/** Where a row opens: its entity's route, else the module. */
function rowHrefFor(
  nav: WorkspaceNav,
  source: ViewSourceId,
): (row: ViewRow) => string | undefined {
  return (row) => {
    if (row.ref) return recordHref(nav, row.ref);
    return nav.moduleHref(SOURCE_MODULE[source]);
  };
}

export function viewConfigOf(block: BlockOf<"view">): ViewConfig {
  const { id: _id, type: _type, title: _title, ...config } = block;
  return config;
}

type RowAction = {
  label: string;
  run: (client: AdminClient, row: ViewRow) => Promise<unknown>;
};

const filtersOn = (
  config: ViewConfig,
  field: string,
  value: ViewFilter["value"],
) =>
  config.filters.some(
    (filter) =>
      filter.field === field && filter.op === "is" && filter.value === value,
  );

/**
 * A one-click action for views whose filter the action takes the row out of,
 * so hiding the row at once is exactly what the server will confirm.
 */
function rowActionFor(config: ViewConfig): RowAction | null {
  if (config.layout !== "list" && config.layout !== "table") return null;
  if (config.group) return null;
  if (config.source === "kanban-cards" && filtersOn(config, "done", false))
    return {
      label: "Complete task",
      run: (client, row) =>
        client.post(`kanban/cards/${encodeURIComponent(row.id)}/complete`, {}),
    };
  if (config.source === "triage" && filtersOn(config, "status", "pending"))
    return {
      label: "Mark reviewed",
      run: (client, row) =>
        client.patch(`triage/${encodeURIComponent(row.id)}`, {
          userStatus: "reviewed",
        }),
    };
  return null;
}

/** One view's rows: shared stale-while-revalidate cache, more on demand. */
export function useViewQuery(
  config: ViewConfig,
  extra: ViewFilter[],
  limit?: number,
) {
  const { client } = useAdmin();
  const today = format(new Date(), "yyyy-MM-dd");
  const key = JSON.stringify({ config, extra, limit, today });
  const descriptor = VIEW_SOURCES[config.source];
  const groupField = viewGroupField(descriptor, config);
  const entry = getViewQueryEntry(client, key, groupField);

  const subscribe = useCallback(
    (listener: () => void) => subscribeViewQuery(entry, listener),
    [entry],
  );
  const snapshot = useCallback(() => entry.state, [entry]);
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);

  const fetchPage = useCallback(
    async (cursor?: string) => {
      const view: ViewConfig = {
        ...config,
        filters: [...config.filters, ...extra],
      };
      return viewQueryResultSchema.parse(
        await client.post("workspace/views/query", {
          view,
          today,
          ...(cursor ? { cursor } : {}),
          ...(limit ? { limit } : {}),
        }),
      );
    },
    // `key` captures config, filters, limit and today's local date.
    [client, key],
  );

  const refresh = useCallback(
    (force = false): Promise<void> => {
      if (entry.inflight) {
        return force
          ? entry.inflight.then(() => refresh(true))
          : entry.inflight;
      }
      if (!force && viewQueryIsFresh(entry)) return Promise.resolve();
      // A cached result stays visible while a stale query refreshes.
      setViewQueryLoading(entry, entry.result === null);
      const request = fetchPage()
        .then((result) => setViewQueryResult(entry, result))
        .catch((error: unknown) => setViewQueryError(entry, error))
        .finally(() => {
          entry.inflight = null;
        });
      entry.inflight = request;
      return request;
    },
    [entry, fetchPage],
  );

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh(true);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const loadMore = useCallback(async () => {
    const cursor = entry.state.result?.nextCursor;
    if (!cursor || entry.inflight) return;
    setViewQueryLoading(entry, true);
    const request = fetchPage(cursor)
      .then((result) => setViewQueryResult(entry, result, true))
      .catch((error: unknown) => setViewQueryError(entry, error))
      .finally(() => {
        entry.inflight = null;
      });
    entry.inflight = request;
    await request;
  }, [entry, fetchPage]);

  const reload = useCallback(() => refresh(true), [refresh]);
  const optimisticRemove = useCallback(
    (row: ViewRow) => optimisticallyRemoveViewRow(entry, row),
    [entry],
  );

  return { ...state, loadMore, reload, optimisticRemove };
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
  const { client } = useAdmin();
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
  const pendingRef = useRef(new Set<string>());

  const fields = useMemo(() => {
    const shown = (config.fields ?? [...descriptor.defaultFields]).filter(
      (field) => field in descriptor.fields,
    );
    return shown.includes(descriptor.titleField)
      ? [
          descriptor.titleField,
          ...shown.filter((field) => field !== descriptor.titleField),
        ]
      : [descriptor.titleField, ...shown];
  }, [config.fields, descriptor]);

  const rowHref = useMemo(
    () => rowHrefFor(nav, config.source),
    [nav, config.source],
  );
  const label = block.title ?? descriptor.label;
  const href = nav.moduleHref(SOURCE_MODULE[config.source]);
  const action = useMemo(() => rowActionFor(config), [config]);

  const actOnRow = useCallback(
    async (row: ViewRow) => {
      if (!action || pendingRef.current.has(row.id)) return;
      const optimistic = query.optimisticRemove(row);
      if (!optimistic) return;
      pendingRef.current.add(row.id);
      try {
        await action.run(client, row);
        await query.reload();
        optimistic.commit();
      } catch (error) {
        optimistic.rollback();
        toast.error(error instanceof Error ? error.message : "Update failed");
      } finally {
        pendingRef.current.delete(row.id);
      }
    },
    [client, action, query.optimisticRemove, query.reload],
  );

  const rowAction = action
    ? (row: ViewRow): ReactNode => (
        <button
          type="button"
          aria-label={`${action.label}: ${String(row.values[descriptor.titleField] ?? "")}`}
          title={action.label}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void actOnRow(row);
          }}
          className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-surface hover:text-accent-strong"
        >
          <Check className="size-3.5" />
        </button>
      )
    : undefined;

  let body: React.ReactNode;
  if (!query.result && query.error) {
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
      rowAction,
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
