"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/ui/alert-dialog";
import { Button } from "@repo/ui/button";
import { Skeleton } from "@repo/ui/skeleton";
import { Textarea } from "@repo/ui/textarea";
import { cn } from "@repo/ui/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import {
  ArrowUpDown,
  BookmarkPlus,
  ChevronRight,
  ListChecks,
  RotateCcw,
  ShoppingBasket,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InlineNotice, useNotice } from "@/components/inline-notice";
import { useFlash } from "@/hooks/use-flash";
import { useHydrated } from "@/hooks/use-hydrated";
import { foodLogQueryKeys } from "@/lib/app-cache/food-log-keys";
import { queryKeys } from "@/lib/app-cache/query-keys";
import type {
  FoodLogDayPayload,
  FoodLogEntry,
} from "@/lib/queries/food-log-day";
import type { WeekTotalsPayload } from "@/lib/queries/food-log-week-totals";
import type { EnteredMeasure } from "../../add/_components/nutrition-detail-drawer";
import { shiftIso, todayIso, weekDaysFor } from "../_lib/date-utils";
import {
  type MealType,
  MoveEntriesDrawer,
  SaveTemplateDrawer,
} from "./bulk-actions-drawers";
import { EntryEditDrawer } from "./entry-edit-drawer";
import { FoodLogHeader } from "./food-log-header";
import { Timeline, type TimelineMode } from "./timeline";

const UNDO_WINDOW_MS = 4_800;

async function fetchDay(
  date: string,
  signal?: AbortSignal,
): Promise<FoodLogDayPayload> {
  const res = await fetch(`/api/food-log/day?date=${date}`, {
    signal,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to load day (${res.status})`);
  return res.json() as Promise<FoodLogDayPayload>;
}

async function fetchWeekTotals(
  start: string,
  end: string,
  signal?: AbortSignal,
): Promise<WeekTotalsPayload> {
  const res = await fetch(
    `/api/food-log/week-totals?start=${start}&end=${end}`,
    { signal, cache: "no-store" },
  );
  if (!res.ok) throw new Error(`Failed to load week totals (${res.status})`);
  return res.json() as Promise<WeekTotalsPayload>;
}

function isValidIsoDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [yearStr, monthStr, dayStr] = dateStr.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/** Keeps the entry's minute so nudging by an hour never rounds it to :00. */
function retimedIso(
  entry: FoodLogEntry,
  hour: number,
  logDate: string,
  timezone: string,
) {
  const minute = entry.eatenAt
    ? toZonedTime(new Date(entry.eatenAt), timezone).getMinutes()
    : 0;
  return fromZonedTime(
    `${logDate}T${pad(hour)}:${pad(minute)}:00`,
    timezone,
  ).toISOString();
}

export function FoodLogClient() {
  const hydrated = useHydrated();
  const searchParams = useSearchParams();
  const initialDate = searchParams.get("date");
  const [selectedDate, setSelectedDate] = useState<string>(() =>
    initialDate && isValidIsoDate(initialDate) ? initialDate : todayIso(),
  );
  const queryClient = useQueryClient();
  const { flash, flashProps } = useFlash();
  const { notice, showError, clear: clearNotice } = useNotice();
  const [pendingRemoval, setPendingRemoval] = useState<Set<string>>(
    () => new Set(),
  );
  const deleteTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [mode, setMode] = useState<TimelineMode>("browse");
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const [editingEntry, setEditingEntry] = useState<FoodLogEntry | null>(null);
  const [isSavingEntry, setIsSavingEntry] = useState(false);
  const [moveDrawerOpen, setMoveDrawerOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isApplyingBulk, setIsApplyingBulk] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: foodLogQueryKeys.day(selectedDate),
    queryFn: ({ signal }) => fetchDay(selectedDate, signal),
    enabled: hydrated,
    staleTime: 60_000,
  });

  const week = useMemo(() => weekDaysFor(selectedDate), [selectedDate]);
  const weekStart = week[0]!.iso;
  const weekEnd = week[week.length - 1]!.iso;

  const { data: weekTotals } = useQuery({
    queryKey: foodLogQueryKeys.weekTotals(weekStart, weekEnd),
    queryFn: ({ signal }) => fetchWeekTotals(weekStart, weekEnd, signal),
    enabled: hydrated,
    staleTime: 60_000,
  });

  const prefetchDate = useCallback(
    (date: string) => {
      void queryClient.prefetchQuery({
        queryKey: foodLogQueryKeys.day(date),
        queryFn: ({ signal }) => fetchDay(date, signal),
        staleTime: 60_000,
      });

      const nearbyWeek = weekDaysFor(date);
      const nearbyStart = nearbyWeek[0]!.iso;
      const nearbyEnd = nearbyWeek[nearbyWeek.length - 1]!.iso;
      void queryClient.prefetchQuery({
        queryKey: foodLogQueryKeys.weekTotals(nearbyStart, nearbyEnd),
        queryFn: ({ signal }) =>
          fetchWeekTotals(nearbyStart, nearbyEnd, signal),
        staleTime: 60_000,
      });
    },
    [queryClient],
  );

  useEffect(() => {
    if (!hydrated) return;
    prefetchDate(shiftIso(selectedDate, -1));
    const nextDate = shiftIso(selectedDate, 1);
    if (nextDate <= todayIso()) {
      prefetchDate(nextDate);
    }
  }, [hydrated, prefetchDate, selectedDate]);

  useEffect(() => {
    setMode("browse");
    setSelection(new Set());
    setEditingEntry(null);
  }, [selectedDate]);

  useEffect(
    () => () => {
      for (const timer of deleteTimers.current.values()) clearTimeout(timer);
    },
    [],
  );

  const refreshLog = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: foodLogQueryKeys.day(selectedDate),
      }),
      queryClient.invalidateQueries({
        queryKey: foodLogQueryKeys.weekTotals(weekStart, weekEnd),
      }),
      queryClient.invalidateQueries({ queryKey: foodLogQueryKeys.activity }),
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
      queryClient.invalidateQueries({ queryKey: queryKeys.calorieSummary }),
    ]);
  }, [queryClient, selectedDate, weekEnd, weekStart]);

  const forgetRemoval = useCallback((id: string) => {
    setPendingRemoval((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }, []);

  const performDelete = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/food-log/entries/${id}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error(`Delete failed (${res.status})`);
        await refreshLog();
      } catch (err) {
        showError(err, "Could not delete entry");
      } finally {
        deleteTimers.current.delete(id);
        forgetRemoval(id);
      }
    },
    [forgetRemoval, refreshLog, showError],
  );

  // The row itself becomes the undo affordance for the length of the window, so
  // nothing has to float over the list to offer it.
  const scheduleDelete = useCallback(
    (id: string) => {
      if (deleteTimers.current.has(id)) return;
      setPendingRemoval((current) => new Set(current).add(id));
      navigator.vibrate?.(20);
      deleteTimers.current.set(
        id,
        setTimeout(() => void performDelete(id), UNDO_WINDOW_MS),
      );
    },
    [performDelete],
  );

  const undoDelete = useCallback(
    (id: string) => {
      const timer = deleteTimers.current.get(id);
      if (timer) clearTimeout(timer);
      deleteTimers.current.delete(id);
      forgetRemoval(id);
      flash(id);
    },
    [flash, forgetRemoval],
  );

  const patchEntry = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      const response = await fetch(`/api/food-log/entries/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`Update failed (${response.status})`);
    },
    [],
  );

  const retimeEntry = useCallback(
    (entry: FoodLogEntry, hour: number) => {
      if (!data || hour < 0 || hour > 23) return;
      const eatenAt = retimedIso(entry, hour, selectedDate, data.timezone);

      // Moved optimistically: the point of the control is watching the row
      // travel, which a round trip would defer.
      queryClient.setQueryData<FoodLogDayPayload>(
        foodLogQueryKeys.day(selectedDate),
        (current) =>
          current
            ? {
                ...current,
                entries: current.entries.map((item) =>
                  item.id === entry.id ? { ...item, eatenAt } : item,
                ),
              }
            : current,
      );
      navigator.vibrate?.(12);
      flash(entry.id);

      void patchEntry(entry.id, { eatenAt }).then(
        () => refreshLog(),
        (err: unknown) => {
          showError(err, "Could not move entry");
          void refreshLog();
        },
      );
    },
    [data, flash, patchEntry, queryClient, refreshLog, selectedDate, showError],
  );

  const saveEntry = useCallback(
    async (
      id: string,
      servings: number,
      measure: EnteredMeasure,
      notes: string,
      eatenAt: string | null,
    ) => {
      setIsSavingEntry(true);
      try {
        await patchEntry(id, {
          servingsConsumed: servings,
          enteredQuantity: measure.quantity,
          enteredUnit: measure.unit,
          notes,
          ...(eatenAt ? { eatenAt } : {}),
        });
        await refreshLog();
        flash(id);
      } catch (err) {
        showError(err, "Could not update entry");
      } finally {
        setIsSavingEntry(false);
      }
    },
    [flash, patchEntry, refreshLog, showError],
  );

  const duplicateEntry = useCallback(
    async (id: string) => {
      try {
        const response = await fetch(`/api/food-log/entries/${id}/duplicate`, {
          method: "POST",
        });
        if (!response.ok) throw new Error("Could not duplicate entry");
        navigator.vibrate?.(20);
        await refreshLog();
        flash("timeline");
      } catch (err) {
        showError(err, "Could not duplicate entry");
      }
    },
    [flash, refreshLog, showError],
  );

  async function postBulkAction(
    method: "DELETE" | "PATCH",
    body: Record<string, unknown>,
  ) {
    setIsApplyingBulk(true);
    try {
      const response = await fetch("/api/food-log/entries/actions", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(
          method === "DELETE"
            ? "Could not delete entries"
            : "Could not move entries",
        );
      }
      setSelection(new Set());
      setMode("browse");
      setMoveDrawerOpen(false);
      setDeleteDialogOpen(false);
      await refreshLog();
      flash("timeline");
    } catch (err) {
      showError(err, "Bulk action failed");
    } finally {
      setIsApplyingBulk(false);
    }
  }

  const entryCount = data?.entries.length ?? 0;

  return (
    <div className="min-h-dvh pb-36">
      <FoodLogHeader
        selectedDate={selectedDate}
        onDateChange={setSelectedDate}
        data={data ?? null}
        weekTotals={weekTotals ?? null}
      >
        <InlineNotice notice={notice} onDismiss={clearNotice} />
      </FoodLogHeader>

      {data ? (
        <EntryAccelerators
          selectedDate={selectedDate}
          entryIds={data.entries
            .filter((entry) => entry.entryType !== "quick_add")
            .map((entry) => entry.id)}
          onChanged={refreshLog}
          onError={showError}
          flash={flash}
          flashProps={flashProps}
        />
      ) : null}

      {entryCount > 0 ? (
        <div className="flex items-center gap-1 border-b border-border/60 px-4 py-1.5">
          <span className="text-[11px] tracking-[0.09em] uppercase text-muted-foreground tabular-nums">
            {entryCount} {entryCount === 1 ? "entry" : "entries"}
          </span>
          <span className="flex-1" />
          <ModeToggle
            icon={ListChecks}
            label="Select"
            active={mode === "select"}
            onClick={() => {
              setSelection(new Set());
              setMode((current) =>
                current === "select" ? "browse" : "select",
              );
            }}
          />
          <ModeToggle
            icon={ArrowUpDown}
            label="Retime"
            active={mode === "reorder"}
            onClick={() => {
              setSelection(new Set());
              setMode((current) =>
                current === "reorder" ? "browse" : "reorder",
              );
            }}
          />
        </div>
      ) : null}

      {!hydrated || isLoading ? (
        <DayLoading />
      ) : isError ? (
        <div className="px-4 pt-6">
          <p className="text-sm text-destructive">
            {error instanceof Error ? error.message : "Failed to load day"}
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-3 rounded-full"
            onClick={() => refetch()}
          >
            Try again
          </Button>
        </div>
      ) : data ? (
        <>
          <div {...flashProps("timeline")}>
            <Timeline
              data={data}
              mode={mode}
              onDeleteEntry={scheduleDelete}
              onEditEntry={setEditingEntry}
              onRetimeEntry={retimeEntry}
              selection={selection}
              onToggleSelection={(id) =>
                setSelection((current) => {
                  const next = new Set(current);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })
              }
              pendingRemoval={pendingRemoval}
              onUndoRemoval={undoDelete}
              flashProps={flashProps}
            />
          </div>
          <DayNote
            selectedDate={selectedDate}
            note={data.note}
            onSaved={refreshLog}
            onError={showError}
            flash={flash}
            flashProps={flashProps}
          />
          <MoreBlock selectedDate={selectedDate} />
          <EntryEditDrawer
            entry={editingEntry}
            day={data}
            isSaving={isSavingEntry}
            onClose={() => setEditingEntry(null)}
            onSave={(id, servings, measure, notes, eatenAt) =>
              void saveEntry(id, servings, measure, notes, eatenAt)
            }
            onDuplicate={(id) => void duplicateEntry(id)}
            onDelete={scheduleDelete}
          />
        </>
      ) : null}

      {mode === "select" && data ? (
        <SelectionBar
          count={selection.size}
          onSelectAll={() =>
            setSelection(new Set(data.entries.map((entry) => entry.id)))
          }
          onMove={() => setMoveDrawerOpen(true)}
          onDelete={() => setDeleteDialogOpen(true)}
          onDone={() => {
            setSelection(new Set());
            setMode("browse");
          }}
        />
      ) : null}

      <MoveEntriesDrawer
        open={moveDrawerOpen}
        count={selection.size}
        selectedDate={selectedDate}
        isSaving={isApplyingBulk}
        onClose={() => setMoveDrawerOpen(false)}
        onMove={(mealType: MealType, logDate: string, hour: number | null) =>
          void postBulkAction("PATCH", {
            entryIds: [...selection],
            mealType,
            logDate,
            ...(hour === null ? {} : { hour }),
          })
        }
      />

      <AlertDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          if (!open && !isApplyingBulk) setDeleteDialogOpen(false);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selection.size}{" "}
              {selection.size === 1 ? "entry" : "entries"}?
            </AlertDialogTitle>
            <AlertDialogDescription className="sr-only">
              Removes the selected entries from this day.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isApplyingBulk}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isApplyingBulk || selection.size === 0}
              onClick={(event) => {
                event.preventDefault();
                void postBulkAction("DELETE", { entryIds: [...selection] });
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ModeToggle({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium transition-colors",
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground active:bg-muted",
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}

function SelectionBar({
  count,
  onSelectAll,
  onMove,
  onDelete,
  onDone,
}: {
  count: number;
  onSelectAll: () => void;
  onMove: () => void;
  onDelete: () => void;
  onDone: () => void;
}) {
  return (
    <div
      className="macros-fixed-inset-x fixed z-50 border-t border-border/70 bg-surface/98 backdrop-blur-xl"
      style={{ bottom: "calc(4.25rem + var(--app-safe-end))" }}
    >
      <div className="flex items-center gap-2 px-4 py-2.5">
        <button
          type="button"
          onClick={onSelectAll}
          className="text-[13px] font-medium text-muted-foreground"
        >
          All
        </button>
        <span className="flex-1 text-center text-[13px] tabular-nums text-muted-foreground">
          {count}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="h-8 rounded-full"
          disabled={!count}
          onClick={onMove}
        >
          Move
        </Button>
        <Button
          size="sm"
          variant="destructive"
          className="h-8 rounded-full"
          disabled={!count}
          onClick={onDelete}
        >
          Delete
        </Button>
        <button
          type="button"
          onClick={onDone}
          className="text-[13px] font-medium text-foreground"
        >
          Done
        </button>
      </div>
    </div>
  );
}

function EntryAccelerators({
  selectedDate,
  entryIds,
  onChanged,
  onError,
  flash,
  flashProps,
}: {
  selectedDate: string;
  entryIds: string[];
  onChanged: () => Promise<void>;
  onError: (error: unknown, fallback: string) => void;
  flash: (key: string) => void;
  flashProps: ReturnType<typeof useFlash>["flashProps"];
}) {
  const queryClient = useQueryClient();
  const [templateDrawerOpen, setTemplateDrawerOpen] = useState(false);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const templates = useQuery({
    queryKey: ["meal-templates"],
    queryFn: async () => {
      const response = await fetch("/api/meal-templates");
      if (!response.ok) throw new Error("Could not load templates");
      return (
        (await response.json()) as {
          items: Array<{ id: string; name: string; itemCount: number }>;
        }
      ).items;
    },
  });

  async function post(url: string, body: unknown) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error("Action failed");
    await onChanged();
  }

  return (
    <section
      {...flashProps("accelerators")}
      className="border-b border-border/60 px-4 py-2"
    >
      <div className="scrollbar-none flex gap-2 overflow-x-auto">
        <Chip
          onClick={() =>
            void post("/api/food-log/copy", {
              sourceDate: shiftIso(selectedDate, -1),
              targetDate: selectedDate,
            }).then(
              () => flash("timeline"),
              (error: unknown) => onError(error, "Could not copy yesterday"),
            )
          }
        >
          <RotateCcw className="size-3.5" />
          Yesterday
        </Chip>
        {(templates.data ?? []).map((template) => (
          <Chip
            key={template.id}
            onClick={() =>
              void post("/api/meal-templates/log", {
                templateId: template.id,
                logDate: selectedDate,
                clientMutationId: crypto.randomUUID(),
              }).then(
                () => flash("timeline"),
                (error: unknown) => onError(error, "Could not log template"),
              )
            }
          >
            {template.name}
            <span className="tabular-nums text-muted-foreground">
              {template.itemCount}
            </span>
          </Chip>
        ))}
        {entryIds.length ? (
          <Chip onClick={() => setTemplateDrawerOpen(true)}>
            <BookmarkPlus className="size-3.5" />
            Save day
          </Chip>
        ) : null}
      </div>

      <SaveTemplateDrawer
        open={templateDrawerOpen}
        count={entryIds.length}
        isSaving={isSavingTemplate}
        onClose={() => setTemplateDrawerOpen(false)}
        onSave={(name) => {
          setIsSavingTemplate(true);
          void post("/api/meal-templates", { name, entryIds })
            .then(
              async () => {
                await queryClient.invalidateQueries({
                  queryKey: ["meal-templates"],
                });
                setTemplateDrawerOpen(false);
                flash("accelerators");
              },
              (error: unknown) => onError(error, "Could not save template"),
            )
            .finally(() => setIsSavingTemplate(false));
        }}
      />
    </section>
  );
}

function Chip({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border/70 px-3 text-[12px] font-medium whitespace-nowrap active:bg-muted"
    >
      {children}
    </button>
  );
}

function DayLoading() {
  return (
    <div>
      {[1, 2, 3, 4].map((row) => (
        <div
          key={row}
          className="flex items-center gap-3 border-t border-border/40 px-4 py-3"
        >
          <Skeleton className="h-3 w-9" />
          <Skeleton className="size-7 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-8/12" />
            <Skeleton className="h-2.5 w-5/12" />
          </div>
          <Skeleton className="h-4 w-8" />
        </div>
      ))}
    </div>
  );
}

function SectionHeading({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-4 pt-6 pb-2">
      <h2 className="text-[11px] font-semibold tracking-[0.09em] uppercase text-muted-foreground">
        {children}
      </h2>
      <span className="h-px flex-1 bg-border/60" aria-hidden="true" />
      {action}
    </div>
  );
}

function DayNote({
  selectedDate,
  note,
  onSaved,
  onError,
  flash,
  flashProps,
}: {
  selectedDate: string;
  note: string | null;
  onSaved: () => Promise<void>;
  onError: (error: unknown, fallback: string) => void;
  flash: (key: string) => void;
  flashProps: ReturnType<typeof useFlash>["flashProps"];
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note ?? "");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setDraft(note ?? "");
    setEditing(false);
  }, [note]);

  async function save() {
    setIsSaving(true);
    try {
      const response = await fetch("/api/food-log/day-note", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ logDate: selectedDate, note: draft }),
      });
      if (!response.ok) throw new Error(`Save failed (${response.status})`);
      setEditing(false);
      await onSaved();
      flash("note");
    } catch (error) {
      onError(error, "Could not save note");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section {...flashProps("note")}>
      <SectionHeading
        action={
          editing ? null : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-[12px] font-medium text-foreground"
            >
              {note ? "Edit" : "Add"}
            </button>
          )
        }
      >
        Notes
      </SectionHeading>

      {editing ? (
        <div className="space-y-2 px-4">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={4}
            maxLength={2000}
            autoComplete="off"
            className="rounded-xl"
          />
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1 rounded-full"
              disabled={isSaving}
              onClick={() => {
                setDraft(note ?? "");
                setEditing(false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="flex-1 rounded-full"
              disabled={isSaving}
              onClick={() => void save()}
            >
              {isSaving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="w-full px-4 pb-2 text-left text-sm leading-relaxed whitespace-pre-wrap"
        >
          {note ?? <span className="text-muted-foreground">—</span>}
        </button>
      )}
    </section>
  );
}

function MoreBlock({ selectedDate }: { selectedDate: string }) {
  return (
    <section className="pb-6">
      <SectionHeading>More</SectionHeading>
      <Link
        href={`/app/food-log/nutrition?date=${selectedDate}`}
        className="flex items-center gap-3 border-t border-border/40 px-4 py-3.5"
      >
        <ListChecks className="size-4 text-muted-foreground" />
        <span className="flex-1 text-sm font-medium">Nutrition overview</span>
        <ChevronRight className="size-4 text-muted-foreground" />
      </Link>
      <Link
        href="/app/shopping-list"
        className="flex items-center gap-3 border-t border-border/40 px-4 py-3.5"
      >
        <ShoppingBasket className="size-4 text-muted-foreground" />
        <span className="flex-1 text-sm font-medium">Shopping list</span>
        <ChevronRight className="size-4 text-muted-foreground" />
      </Link>
    </section>
  );
}
