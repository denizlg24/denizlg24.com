"use client";

import { Button } from "@repo/ui/button";
import { EmptyState } from "@repo/ui/empty-state";
import { List, ListRow } from "@repo/ui/list";
import { Page } from "@repo/ui/page";
import { Skeleton } from "@repo/ui/skeleton";
import { SplitList, SplitView } from "@repo/ui/split-view";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  format,
  isAfter,
  isSameMonth,
  isToday,
  startOfDay,
  startOfMonth,
  subMonths,
} from "date-fns";
import { BookOpen, ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { DashboardPageHeader } from "@/components/navigation/dashboard-page-header";
import { useUserSettings } from "@/context/user-context";
import { denizApi } from "@/lib/api-wrapper";
import type { IJournalLog } from "@/lib/data-types";
import { cn } from "@/lib/utils";
import { JournalEntry } from "./_components/journal-entry";

const dayKey = (date: Date | string) => format(new Date(date), "yyyy-MM-dd");

function preview(content: string) {
  const line = content
    .split("\n")
    .map((text) => text.replace(/^[#>*\-\s]+/, "").trim())
    .find(Boolean);
  return line ?? null;
}

export default function JournalPage() {
  const { settings, loading: loadingSettings } = useUserSettings();

  const API = useMemo(() => {
    if (loadingSettings) return null;
    return new denizApi();
  }, [settings, loadingSettings]);

  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [journals, setJournals] = useState<IJournalLog[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedJournal, setSelectedJournal] = useState<IJournalLog | null>(
    null,
  );
  const [entryLoading, setEntryLoading] = useState(false);

  const cache = useRef<Map<string, IJournalLog[]>>(new Map());
  // Only the latest click may land: a slow response for an earlier day must
  // not replace the entry the owner has since moved to.
  const selectToken = useRef(0);

  const fetchJournals = useCallback(
    async (monthDate: Date, skipCache = false) => {
      if (!API) return;
      const start = startOfMonth(monthDate);
      const end = endOfMonth(monthDate);
      const key = format(start, "yyyy-MM");

      if (!skipCache && cache.current.has(key)) {
        setJournals(cache.current.get(key) ?? []);
        setLoading(false);
        return;
      }

      setLoading(true);
      const result = await API.GET<{ journals: IJournalLog[] }>({
        endpoint: `journal?start=${start.toISOString()}&end=${end.toISOString()}`,
      });
      if (!("code" in result)) {
        cache.current.set(key, result.journals);
        setJournals(result.journals);
      }
      setLoading(false);
    },
    [API],
  );

  useEffect(() => {
    void fetchJournals(month);
  }, [fetchJournals, month]);

  const journalsByDay = useMemo(
    () => new Map(journals.map((journal) => [dayKey(journal.date), journal])),
    [journals],
  );

  const days = useMemo(() => {
    const today = startOfDay(new Date());
    return eachDayOfInterval({
      start: startOfMonth(month),
      end: endOfMonth(month),
    })
      .filter((day) => !isAfter(day, today))
      .reverse();
  }, [month]);

  const handleSelectDate = useCallback(
    async (date: Date) => {
      if (!API) return;
      const token = ++selectToken.current;
      setSelectedDate(date);
      setEntryLoading(true);

      const existing = journalsByDay.get(dayKey(date));
      let next: IJournalLog | null = null;

      if (existing) {
        const result = await API.GET<{ journal: IJournalLog }>({
          endpoint: `journal/${existing._id}`,
        });
        next = "code" in result ? existing : result.journal;
      } else {
        const result = await API.POST<{ journal: IJournalLog }>({
          endpoint: "journal",
          body: { date: startOfDay(date).toISOString() },
        });
        if ("code" in result) {
          toast.error(result.message);
        } else {
          next = result.journal;
          const created = result.journal;
          setJournals((prev) =>
            prev.some((j) => j._id === created._id) ? prev : [...prev, created],
          );
          cache.current.delete(format(startOfMonth(date), "yyyy-MM"));
        }
      }

      if (token !== selectToken.current) return;
      if (!next) setSelectedDate(null);
      setSelectedJournal(next);
      setEntryLoading(false);
    },
    [API, journalsByDay],
  );

  const handleBack = useCallback(() => {
    selectToken.current++;
    setSelectedDate(null);
    setSelectedJournal(null);
    setEntryLoading(false);
  }, []);

  const handleJournalUpdate = useCallback((updated: IJournalLog) => {
    setSelectedJournal(updated);
    setJournals((prev) =>
      prev.map((j) => (j._id === updated._id ? updated : j)),
    );
    cache.current.delete(
      format(startOfMonth(new Date(updated.date)), "yyyy-MM"),
    );
  }, []);

  const atCurrentMonth = isSameMonth(month, new Date());
  const selectedKey = selectedDate ? dayKey(selectedDate) : null;

  const list = (
    <SplitList
      header={
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Previous month"
            onClick={() => setMonth((current) => subMonths(current, 1))}
          >
            <ChevronLeft />
          </Button>
          <span className="flex-1 text-center text-sm font-medium text-accent-strong tabular-nums">
            {format(month, "MMMM yyyy")}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Next month"
            disabled={atCurrentMonth}
            onClick={() => setMonth((current) => addMonths(current, 1))}
          >
            <ChevronRight />
          </Button>
        </div>
      }
    >
      {loading ? (
        <div className="flex flex-col gap-1">
          {Array.from({ length: 10 }).map((_, index) => (
            <div
              key={index}
              className="flex h-11 flex-col justify-center gap-1.5 px-2"
            >
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className={cn("h-3", index % 2 ? "w-40" : "w-52")} />
            </div>
          ))}
        </div>
      ) : days.length === 0 ? (
        <EmptyState compact label="No days" />
      ) : (
        <List>
          {days.map((day) => {
            const key = dayKey(day);
            const journal = journalsByDay.get(key);
            const text = journal ? preview(journal.content) : null;
            const eventCount = journal?.events.length ?? 0;
            return (
              <ListRow
                key={key}
                selected={key === selectedKey}
                onClick={() => void handleSelectDate(day)}
                leading={
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      text
                        ? "bg-accent-strong"
                        : journal
                          ? "bg-muted-foreground/40"
                          : "bg-border",
                    )}
                  />
                }
                title={
                  <span className={cn(!text && "text-muted-foreground")}>
                    {isToday(day) ? "Today" : format(day, "EEE d")}
                  </span>
                }
                description={text ?? undefined}
                meta={eventCount > 0 ? eventCount : undefined}
              />
            );
          })}
        </List>
      )}
    </SplitList>
  );

  const detail =
    selectedDate && selectedJournal && !entryLoading ? (
      <JournalEntry
        key={selectedJournal._id}
        journal={selectedJournal}
        date={selectedDate}
        onBack={handleBack}
        API={API}
        onJournalUpdate={handleJournalUpdate}
      />
    ) : selectedDate ? (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-5 py-6 sm:px-8">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-3 w-16" />
        <Skeleton className="mt-4 h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    ) : (
      <EmptyState icon={<BookOpen />} label="No entry selected" />
    );

  return (
    <Page>
      <DashboardPageHeader icon={<BookOpen />} title="Journal">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            const today = new Date();
            setMonth(startOfMonth(today));
            void handleSelectDate(today);
          }}
        >
          Today
        </Button>
      </DashboardPageHeader>
      <SplitView
        detailOpen={selectedDate !== null}
        listWidth="md:w-72"
        list={list}
        detail={detail}
      />
    </Page>
  );
}
