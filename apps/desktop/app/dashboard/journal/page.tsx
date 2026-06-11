"use client";

import { endOfMonth, format, startOfDay, startOfMonth } from "date-fns";
import { BookOpen } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUserSettings } from "@/context/user-context";
import { denizApi } from "@/lib/api-wrapper";
import type { IJournalLog } from "@/lib/data-types";
import { JournalEntry } from "./_components/journal-entry";
import { JournalGrid } from "./_components/journal-grid";

export default function JournalPage() {
  const { settings, loading: loadingSettings } = useUserSettings();

  const API = useMemo(() => {
    if (loadingSettings) return null;
    return new denizApi(settings.apiKey);
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
    fetchJournals(month);
  }, [fetchJournals, month]);

  const handleSelectDate = useCallback(
    async (date: Date) => {
      if (!API) return;
      setSelectedDate(date);
      setEntryLoading(true);

      const dateKey = format(date, "yyyy-MM-dd");
      const existing = journals.find(
        (j) => format(new Date(j.date), "yyyy-MM-dd") === dateKey,
      );

      if (existing) {
        const result = await API.GET<{ journal: IJournalLog }>({
          endpoint: `journal/${existing._id}`,
        });
        if (!("code" in result)) {
          setSelectedJournal(result.journal);
        } else {
          setSelectedJournal(existing);
        }
      } else {
        const result = await API.POST<{ journal: IJournalLog }>({
          endpoint: "journal",
          body: { date: startOfDay(date).toISOString() },
        });
        if (!("code" in result)) {
          setSelectedJournal(result.journal);
          setJournals((prev) => [...prev, result.journal]);
          const key = format(startOfMonth(date), "yyyy-MM");
          cache.current.delete(key);
        }
      }
      setEntryLoading(false);
    },
    [API, journals],
  );

  const handleBack = useCallback(() => {
    setSelectedDate(null);
    setSelectedJournal(null);
    fetchJournals(month, true);
  }, [fetchJournals, month]);

  const handleJournalUpdate = useCallback(
    (updated: IJournalLog) => {
      setSelectedJournal(updated);
      setJournals((prev) =>
        prev.map((j) => (j._id === updated._id ? updated : j)),
      );
      const key = format(startOfMonth(month), "yyyy-MM");
      cache.current.delete(key);
    },
    [month],
  );

  if (selectedDate && selectedJournal) {
    return (
      <div className="h-full px-4">
        <JournalEntry
          journal={selectedJournal}
          date={selectedDate}
          onBack={handleBack}
          API={API}
          onJournalUpdate={handleJournalUpdate}
        />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-4 border-b h-12 shrink-0">
        <BookOpen className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold flex-1">Journal</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto flex items-start justify-center px-4 py-8">
        <JournalGrid
          month={month}
          journals={journals}
          loading={loading || entryLoading}
          onSelectDate={handleSelectDate}
          onMonthChange={setMonth}
        />
      </div>
    </div>
  );
}
