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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookmarkPlus,
  ChevronRight,
  ListChecks,
  Pencil,
  Plus,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
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
import { Timeline } from "./timeline";

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

export function FoodLogClient() {
  const hydrated = useHydrated();
  const searchParams = useSearchParams();
  const initialDate = searchParams.get("date");
  const [selectedDate, setSelectedDate] = useState<string>(() =>
    initialDate && isValidIsoDate(initialDate) ? initialDate : todayIso(),
  );
  const queryClient = useQueryClient();
  const [hiddenEntryIds, setHiddenEntryIds] = useState<Set<string>>(
    () => new Set(),
  );
  const deleteTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const [editingEntry, setEditingEntry] = useState<FoodLogEntry | null>(null);
  const [isSavingServing, setIsSavingServing] = useState(false);
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
    setSelecting(false);
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
      queryClient.invalidateQueries({ queryKey: ["app", "calorie-summary"] }),
    ]);
  }, [queryClient, selectedDate, weekEnd, weekStart]);

  async function performDelete(id: string) {
    try {
      const res = await fetch(`/api/food-log/entries/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      await refreshLog();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not delete entry",
      );
    } finally {
      deleteTimers.current.delete(id);
      setHiddenEntryIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  function scheduleDelete(id: string) {
    if (deleteTimers.current.has(id)) return;
    setHiddenEntryIds((current) => new Set(current).add(id));
    navigator.vibrate?.(20);
    const timer = setTimeout(() => void performDelete(id), 4_800);
    deleteTimers.current.set(id, timer);
    toast("Removed from log", {
      duration: 5_000,
      action: {
        label: "Undo",
        onClick: () => {
          clearTimeout(timer);
          deleteTimers.current.delete(id);
          setHiddenEntryIds((current) => {
            const next = new Set(current);
            next.delete(id);
            return next;
          });
        },
      },
    });
  }

  async function duplicateEntry(id: string) {
    const response = await fetch(`/api/food-log/entries/${id}/duplicate`, {
      method: "POST",
    });
    if (!response.ok) return toast.error("Could not duplicate entry");
    navigator.vibrate?.(20);
    await refreshLog();
  }

  async function updateServing(
    id: string,
    servings: number,
    measure: EnteredMeasure,
    notes: string,
  ) {
    setIsSavingServing(true);
    try {
      const response = await fetch(`/api/food-log/entries/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          servingsConsumed: servings,
          enteredQuantity: measure.quantity,
          enteredUnit: measure.unit,
          notes,
        }),
      });
      if (!response.ok) return toast.error("Could not update serving");
      await refreshLog();
    } finally {
      setIsSavingServing(false);
    }
  }

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
        toast.error(
          method === "DELETE"
            ? "Could not delete entries"
            : "Could not move entries",
        );
        return;
      }
      setSelection(new Set());
      setSelecting(false);
      setMoveDrawerOpen(false);
      setDeleteDialogOpen(false);
      await refreshLog();
    } finally {
      setIsApplyingBulk(false);
    }
  }

  return (
    <div className="min-h-dvh pb-36">
      <FoodLogHeader
        selectedDate={selectedDate}
        onDateChange={setSelectedDate}
        data={data ?? null}
        weekTotals={weekTotals ?? null}
      />

      {data ? (
        <EntryAccelerators
          selectedDate={selectedDate}
          entryIds={data.entries
            .filter((entry) => entry.entryType !== "quick_add")
            .map((entry) => entry.id)}
          onChanged={refreshLog}
        />
      ) : null}

      {data?.entries.length ? (
        <div className="flex items-center gap-2 border-b px-4 py-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setSelecting((value) => !value);
              setSelection(new Set());
            }}
          >
            {selecting ? "Done" : "Select"}
          </Button>
          {selecting ? (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setSelection(new Set(data.entries.map((entry) => entry.id)))
                }
              >
                All
              </Button>
              <span className="flex-1 text-xs text-muted-foreground">
                {selection.size} selected
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={!selection.size}
                onClick={() => setMoveDrawerOpen(true)}
              >
                Move
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={!selection.size}
                onClick={() => setDeleteDialogOpen(true)}
              >
                Delete
              </Button>
            </>
          ) : null}
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
            className="mt-3"
            onClick={() => refetch()}
          >
            Try again
          </Button>
        </div>
      ) : data ? (
        <>
          <Timeline
            data={{
              ...data,
              entries: data.entries.filter(
                (entry) => !hiddenEntryIds.has(entry.id),
              ),
            }}
            onDeleteEntry={scheduleDelete}
            onEditEntry={setEditingEntry}
            selection={selecting ? selection : undefined}
            onToggleSelection={
              selecting
                ? (id) =>
                    setSelection((current) => {
                      const next = new Set(current);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      return next;
                    })
                : undefined
            }
          />
          <DayNote
            selectedDate={selectedDate}
            note={data.note}
            onSaved={refreshLog}
          />
          <MoreBlock selectedDate={selectedDate} />
          <EntryEditDrawer
            entry={editingEntry}
            day={data}
            isSaving={isSavingServing}
            onClose={() => setEditingEntry(null)}
            onSave={(id, servings, measure, notes) =>
              void updateServing(id, servings, measure, notes)
            }
            onDuplicate={(id) => void duplicateEntry(id)}
            onDelete={scheduleDelete}
          />
        </>
      ) : null}

      <MoveEntriesDrawer
        open={moveDrawerOpen}
        count={selection.size}
        selectedDate={selectedDate}
        isSaving={isApplyingBulk}
        onClose={() => setMoveDrawerOpen(false)}
        onMove={(mealType: MealType, logDate: string) =>
          void postBulkAction("PATCH", {
            entryIds: [...selection],
            mealType,
            logDate,
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

function EntryAccelerators({
  selectedDate,
  entryIds,
  onChanged,
}: {
  selectedDate: string;
  entryIds: string[];
  onChanged: () => Promise<void>;
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
    <section className="border-b px-4 py-3">
      <div className="flex gap-2 overflow-x-auto pb-1">
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() =>
            void post("/api/food-log/copy", {
              sourceDate: shiftIso(selectedDate, -1),
              targetDate: selectedDate,
            }).then(
              () => toast.success("Copied previous day"),
              () => toast.error("Could not copy previous day"),
            )
          }
        >
          <RotateCcw />
          Copy yesterday
        </Button>
        {(templates.data ?? []).map((template) => (
          <Button
            key={template.id}
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() =>
              void post("/api/meal-templates/log", {
                templateId: template.id,
                logDate: selectedDate,
                clientMutationId: crypto.randomUUID(),
              }).then(
                () => toast.success(`Logged ${template.name}`),
                () => toast.error("Could not log template"),
              )
            }
          >
            {template.name} · {template.itemCount}
          </Button>
        ))}
        {entryIds.length ? (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={() => setTemplateDrawerOpen(true)}
          >
            <BookmarkPlus />
            Save day
          </Button>
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
                toast.success("Meal template saved");
              },
              () => toast.error("Could not save template"),
            )
            .finally(() => setIsSavingTemplate(false));
        }}
      />
    </section>
  );
}

function DayLoading() {
  return (
    <div className="px-4 pt-6 space-y-3">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-6 w-12 rounded-full" />
          <Skeleton className="h-14 flex-1 rounded-xl" />
        </div>
      ))}
    </div>
  );
}

function DayNote({
  selectedDate,
  note,
  onSaved,
}: {
  selectedDate: string;
  note: string | null;
  onSaved: () => Promise<void>;
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
      if (!response.ok) {
        toast.error("Could not save note");
        return;
      }
      setEditing(false);
      await onSaved();
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="px-4 pt-2 pb-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-2xl font-semibold tracking-tight">Notes</h2>
        {editing ? null : (
          <Button
            type="button"
            variant="default"
            size="icon"
            className="rounded-full"
            aria-label={note ? "Edit note" : "Add note"}
            onClick={() => setEditing(true)}
          >
            {note ? <Pencil className="size-4" /> : <Plus className="size-4" />}
          </Button>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
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
          className="w-full rounded-xl bg-muted/40 px-4 py-5 text-left text-sm whitespace-pre-wrap"
        >
          {note ?? <span className="text-muted-foreground">—</span>}
        </button>
      )}
    </section>
  );
}

function MoreBlock({ selectedDate }: { selectedDate: string }) {
  return (
    <section className="px-4 pt-2 pb-10">
      <h2 className="text-2xl font-semibold tracking-tight mb-2">More</h2>
      <div className="rounded-xl bg-muted/40 divide-y divide-border/40">
        <Link
          href={`/app/food-log/nutrition?date=${selectedDate}`}
          className="flex items-center gap-3 px-4 py-4"
        >
          <ListChecks className="size-5 text-foreground" />
          <span className="flex-1 text-sm font-medium">Nutrition Overview</span>
          <ChevronRight className="size-4 text-muted-foreground" />
        </Link>
        <button
          type="button"
          disabled
          className="w-full flex items-center gap-3 px-4 py-4 disabled:opacity-60 text-left"
        >
          <SlidersHorizontal className="size-5 text-foreground" />
          <span className="flex-1 text-sm font-medium">Customize Food Log</span>
          <ChevronRight className="size-4 text-muted-foreground" />
        </button>
      </div>
    </section>
  );
}
