"use client";

import { Button } from "@repo/ui/button";
import { Meter } from "@repo/ui/meter";
import { Page, PageBody } from "@repo/ui/page";
import { Stat, StatGroup } from "@repo/ui/stat";
import { FilterTabs } from "@repo/ui/toolbar";
import { isSameDay, isSameWeek } from "date-fns";
import {
  AlarmClock,
  History,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
} from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { DashboardPageHeader } from "@/components/navigation/dashboard-page-header";
import { cn } from "@/lib/utils";
import {
  DURATIONS,
  POMODORO_TARGET,
  type TimerMode,
  usePomodoroStore,
} from "@/stores/pomodoro";
import { formatFocusMinutes } from "./format";

const MODE_OPTIONS: { value: TimerMode; label: string }[] = [
  { value: "focus", label: "Focus" },
  { value: "break", label: "Break" },
];

export default function PomodoroPage() {
  const mode = usePomodoroStore((s) => s.mode);
  const seconds = usePomodoroStore((s) => s.seconds);
  const running = usePomodoroStore((s) => s.running);
  const allSessions = usePomodoroStore((s) => s.allSessions);
  const toggleStartPause = usePomodoroStore((s) => s.toggleStartPause);
  const reset = usePomodoroStore((s) => s.reset);
  const switchMode = usePomodoroStore((s) => s.switchMode);

  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const totalDuration = DURATIONS[mode];
  const progress = (totalDuration - seconds) / totalDuration;

  // Derived from the log rather than the store's sessionCount, which is only
  // computed at hydrate and so keeps yesterday's count past midnight.
  const stats = useMemo(() => {
    const now = new Date();
    let todayCount = 0;
    let todaySeconds = 0;
    let weekSeconds = 0;
    for (const session of allSessions) {
      const completed = new Date(session.completedAt);
      if (isSameDay(completed, now)) {
        todayCount++;
        todaySeconds += session.duration;
      }
      if (isSameWeek(completed, now, { weekStartsOn: 1 })) {
        weekSeconds += session.duration;
      }
    }
    return { todayCount, todaySeconds, weekSeconds };
  }, [allSessions]);

  return (
    <Page>
      <DashboardPageHeader icon={<AlarmClock />} title="Pomodoro">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/dashboard/pomodoro/history">
            <History />
            History
          </Link>
        </Button>
      </DashboardPageHeader>

      <PageBody width="narrow" className="gap-12 py-12">
        <div className="flex flex-col items-center gap-8">
          <FilterTabs
            value={mode}
            onChange={(next) => {
              if (next !== mode) switchMode(next);
            }}
            options={MODE_OPTIONS}
          />

          <div className="flex w-full max-w-md flex-col items-center gap-6">
            <span
              className={cn(
                "font-calistoga text-8xl leading-none tabular-nums tracking-tight transition-colors sm:text-9xl",
                running ? "text-accent-strong" : "text-accent-strong/70",
              )}
            >
              {String(mins).padStart(2, "0")}
              <span className="text-muted-foreground/40">:</span>
              {String(secs).padStart(2, "0")}
            </span>
            <Meter value={progress} className="w-full" />
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Reset"
              className="text-muted-foreground"
              onClick={reset}
            >
              <RotateCcw />
            </Button>
            <Button size="lg" className="min-w-28" onClick={toggleStartPause}>
              {running ? <Pause /> : <Play />}
              {running ? "Pause" : "Start"}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Skip"
              className="text-muted-foreground"
              onClick={() => switchMode(mode === "focus" ? "break" : "focus")}
            >
              <SkipForward />
            </Button>
          </div>

          <div className="flex items-center gap-1.5" aria-hidden>
            {Array.from({ length: POMODORO_TARGET }).map((_, i) => (
              <span
                key={i}
                className={cn(
                  "size-1.5 rounded-full",
                  i < stats.todayCount ? "bg-accent-strong" : "bg-border",
                )}
              />
            ))}
          </div>
        </div>

        <StatGroup>
          <Stat
            label="Today"
            value={`${stats.todayCount}/${POMODORO_TARGET}`}
            tone={stats.todayCount >= POMODORO_TARGET ? "good" : "default"}
          />
          <Stat
            label="Focus today"
            value={formatFocusMinutes(stats.todaySeconds)}
          />
          <Stat
            label="This week"
            value={formatFocusMinutes(stats.weekSeconds)}
          />
          <Stat label="Sessions" value={allSessions.length} />
        </StatGroup>
      </PageBody>
    </Page>
  );
}
