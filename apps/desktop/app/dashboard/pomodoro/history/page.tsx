"use client";

import { Button } from "@repo/ui/button";
import { format, isToday, startOfDay } from "date-fns";
import { ArrowLeft, History, Trash2 } from "lucide-react";
import Link from "next/link";
import { type Session, usePomodoroStore } from "@/stores/pomodoro";

function groupSessionsByDate(sessions: Session[]) {
  const groups = new Map<string, Session[]>();
  for (const s of sessions) {
    const dayKey = startOfDay(new Date(s.completedAt)).toISOString();
    const existing = groups.get(dayKey) ?? [];
    existing.push(s);
    groups.set(dayKey, existing);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => new Date(b).getTime() - new Date(a).getTime())
    .map(([dayIso, items]) => ({
      date: new Date(dayIso),
      sessions: items.sort(
        (a, b) =>
          new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime(),
      ),
      totalFocusMinutes: items.reduce((acc, s) => acc + s.duration / 60, 0),
    }));
}

export default function PomodoroHistoryRoute() {
  const allSessions = usePomodoroStore((s) => s.allSessions);
  const clearAllSessions = usePomodoroStore((s) => s.clearAllSessions);
  const grouped = groupSessionsByDate(allSessions);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="z-10 flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <History className="size-4 text-muted-foreground" />
        <span className="flex-1 text-sm font-semibold">History</span>
        {allSessions.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearAllSessions}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
            <span className="text-xs">Clear</span>
          </Button>
        )}
        <Button variant="outline" size="sm" asChild>
          <Link href="/dashboard/pomodoro">
            <ArrowLeft className="size-3.5" />
            Pomodoro
          </Link>
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-5">
          {grouped.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">—</p>
          ) : (
            grouped.map((group) => (
              <div key={group.date.toISOString()}>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {isToday(group.date)
                      ? "Today"
                      : format(group.date, "MMM d, yyyy")}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {Math.round(group.totalFocusMinutes)}m
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  {group.sessions.map((session, i) => (
                    <div
                      key={`${session.completedAt}-${i}`}
                      className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-secondary/50"
                    >
                      <span className="text-sm text-card-foreground">
                        {format(new Date(session.startedAt), "h:mm a")}
                      </span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {Math.round(session.duration / 60)}m
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
