"use client";

import { format, isToday, startOfDay } from "date-fns";
import { AlarmClock, History, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  DURATIONS,
  POMODORO_TARGET,
  type Session,
  usePomodoroStore,
} from "@/stores/pomodoro";

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

export default function PomodoroPage() {
  const mode = usePomodoroStore((s) => s.mode);
  const seconds = usePomodoroStore((s) => s.seconds);
  const running = usePomodoroStore((s) => s.running);
  const sessionCount = usePomodoroStore((s) => s.sessionCount);
  const allSessions = usePomodoroStore((s) => s.allSessions);
  const toggleStartPause = usePomodoroStore((s) => s.toggleStartPause);
  const reset = usePomodoroStore((s) => s.reset);
  const switchMode = usePomodoroStore((s) => s.switchMode);
  const clearAllSessions = usePomodoroStore((s) => s.clearAllSessions);

  const [historyOpen, setHistoryOpen] = useState(false);

  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const totalDuration = DURATIONS[mode];
  const progress = (totalDuration - seconds) / totalDuration;
  const cx = 200;
  const cy = 200;
  const r = 170;
  const strokeWidth = 6;
  const arcLength = Math.PI * r;
  const filledLength = arcLength * progress;
  const arcPath = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;

  const todaySessions = allSessions.filter((s) =>
    isToday(new Date(s.completedAt)),
  );

  const groupedSessions = groupSessionsByDate(allSessions);

  return (
    <div className="flex flex-col gap-2 pb-4 h-full relative overflow-hidden">
      <div className="flex items-center gap-2 px-4 border-b h-12 shrink-0 z-10">
        <AlarmClock className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold flex-1">Pomodoro</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setHistoryOpen(true)}
          className="text-muted-foreground"
        >
          <History className="size-3.5" />
          <span className="text-xs">History</span>
        </Button>
      </div>

      <div className="w-full h-full flex flex-col items-center pt-12 px-4 max-w-xl mx-auto z-10">
        <div className="flex items-center gap-6 mb-2">
          <span
            className={cn(
              "text-xs tracking-widest uppercase transition-colors",
              mode === "focus"
                ? "text-card-foreground font-medium"
                : "text-muted-foreground/50",
            )}
          >
            Focus
          </span>
          <span className="text-muted-foreground/30 text-xs">{"/"}</span>
          <span
            className={cn(
              "text-xs tracking-widest uppercase transition-colors",
              mode === "break"
                ? "text-card-foreground font-medium"
                : "text-muted-foreground/50",
            )}
          >
            Break
          </span>
        </div>
        <div className="relative w-full aspect-20/11">
          <svg viewBox="0 0 400 220" className="w-full h-full" fill="none">
            <path
              d={arcPath}
              stroke="currentColor"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              className="text-border"
              fill="none"
            />
            <path
              d={arcPath}
              stroke="currentColor"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={`${arcLength}`}
              strokeDashoffset={`${arcLength - filledLength}`}
              className="text-primary transition-[stroke-dashoffset] duration-1000 ease-linear"
              fill="none"
            />

            {Array.from({
              length: Math.floor(totalDuration / 60 / 5) + 1,
            }).map((_, i) => {
              const angle = Math.PI * (1 - (i * 5 * 60) / totalDuration);
              const outerR = r + 12;
              const innerR = r + 6;
              return (
                <line
                  key={i}
                  x1={cx + innerR * Math.cos(angle)}
                  y1={cy - innerR * Math.sin(angle)}
                  x2={cx + outerR * Math.cos(angle)}
                  y2={cy - outerR * Math.sin(angle)}
                  stroke="currentColor"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  className="text-muted-foreground/25"
                />
              );
            })}
          </svg>

          <div className="absolute inset-0 flex flex-col items-center justify-end pb-[8%]">
            <span className="text-7xl font-mono font-light text-card-foreground tabular-nums tracking-tight sm:text-8xl">
              {String(mins).padStart(2, "0")}
              <span className="text-muted-foreground/40">:</span>
              {String(secs).padStart(2, "0")}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-8 mt-2">
          <button
            onClick={reset}
            className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
            aria-label="Reset timer"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </button>

          <button
            onClick={toggleStartPause}
            className="flex items-center justify-center size-14 rounded-full border border-border text-card-foreground hover:bg-secondary transition-colors"
            aria-label={running ? "Pause timer" : "Start timer"}
          >
            {running ? (
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11.5-6.86a1 1 0 0 0 0-1.72L9.5 4.28A1 1 0 0 0 8 5.14Z" />
              </svg>
            )}
          </button>

          <button
            onClick={() => switchMode(mode === "focus" ? "break" : "focus")}
            className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
            aria-label="Skip to next mode"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon
                points="5 4 15 12 5 20 5 4"
                fill="currentColor"
                stroke="none"
              />
              <line x1="19" y1="5" x2="19" y2="19" />
            </svg>
          </button>
        </div>

        <div className="flex items-center gap-2 mt-6">
          {Array.from({ length: POMODORO_TARGET }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "size-2 rounded-full transition-colors",
                i < sessionCount
                  ? "bg-primary"
                  : "border border-muted-foreground/30",
              )}
            />
          ))}
          {sessionCount > POMODORO_TARGET && (
            <span className="text-xs text-muted-foreground ml-1">
              +{sessionCount - POMODORO_TARGET}
            </span>
          )}
        </div>
      </div>

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="right" className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Session History</SheetTitle>
            <SheetDescription>
              {todaySessions.length} session{todaySessions.length !== 1 && "s"}{" "}
              today
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-6 px-4 pb-6">
            {groupedSessions.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">
                No sessions yet. Start your first focus!
              </p>
            )}
            {groupedSessions.map((group) => (
              <div key={group.date.toISOString()}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {isToday(group.date)
                      ? "Today"
                      : format(group.date, "MMM d, yyyy")}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {Math.round(group.totalFocusMinutes)}m total
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  {group.sessions.map((session, i) => (
                    <div
                      key={`${session.completedAt}-${i}`}
                      className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-secondary/50"
                    >
                      <span className="text-sm text-card-foreground">
                        {format(new Date(session.startedAt), "h:mm a")}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {Math.round(session.duration / 60)}m
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {allSessions.length > 0 && (
            <SheetFooter>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAllSessions}
                className="text-muted-foreground hover:text-destructive w-full"
              >
                <Trash2 className="size-3" />
                <span>Clear all sessions</span>
              </Button>
            </SheetFooter>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
