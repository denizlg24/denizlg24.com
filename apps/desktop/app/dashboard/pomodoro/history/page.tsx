"use client";

import { Button } from "@repo/ui/button";
import { ConfirmButton } from "@repo/ui/confirm-button";
import { EmptyState } from "@repo/ui/empty-state";
import { List, ListGroupLabel, ListRow } from "@repo/ui/list";
import { Page, PageBody } from "@repo/ui/page";
import { Stat, StatGroup } from "@repo/ui/stat";
import { format, isToday, isYesterday, startOfDay } from "date-fns";
import { History, Timer, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { DashboardPageHeader } from "@/components/navigation/dashboard-page-header";
import { type Session, usePomodoroStore } from "@/stores/pomodoro";
import { formatFocusMinutes } from "../format";

function groupSessionsByDate(sessions: Session[]) {
  const groups = new Map<number, Session[]>();
  for (const s of sessions) {
    const day = startOfDay(new Date(s.completedAt)).getTime();
    const existing = groups.get(day) ?? [];
    existing.push(s);
    groups.set(day, existing);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => b - a)
    .map(([day, items]) => ({
      date: new Date(day),
      sessions: [...items].sort(
        (a, b) =>
          new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime(),
      ),
      focusSeconds: items.reduce((acc, s) => acc + s.duration, 0),
    }));
}

function dayLabel(date: Date) {
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "EEE, MMM d, yyyy");
}

export default function PomodoroHistoryRoute() {
  const router = useRouter();
  const allSessions = usePomodoroStore((s) => s.allSessions);
  const clearAllSessions = usePomodoroStore((s) => s.clearAllSessions);
  const grouped = useMemo(
    () => groupSessionsByDate(allSessions),
    [allSessions],
  );

  const totalSeconds = useMemo(
    () => allSessions.reduce((acc, s) => acc + s.duration, 0),
    [allSessions],
  );

  return (
    <Page>
      <DashboardPageHeader
        icon={<History />}
        title="History"
        crumbs={[
          {
            label: "Pomodoro",
            onClick: () => router.push("/dashboard/pomodoro"),
          },
        ]}
      >
        {allSessions.length > 0 ? (
          <ConfirmButton
            trigger={
              <Button variant="ghost" size="icon-sm" aria-label="Clear history">
                <Trash2 />
              </Button>
            }
            title="Clear history?"
            description={`${allSessions.length} sessions`}
            actionLabel="Clear"
            destructive
            onConfirm={clearAllSessions}
          />
        ) : null}
      </DashboardPageHeader>

      <PageBody width="narrow">
        {grouped.length === 0 ? (
          <EmptyState icon={<Timer />} label="No sessions" />
        ) : (
          <>
            <StatGroup>
              <Stat label="Sessions" value={allSessions.length} />
              <Stat label="Focus" value={formatFocusMinutes(totalSeconds)} />
              <Stat label="Days" value={grouped.length} />
            </StatGroup>
            <List>
              {grouped.map((group) => (
                <div key={group.date.getTime()} className="flex flex-col">
                  <ListGroupLabel className="flex items-center justify-between">
                    <span>{dayLabel(group.date)}</span>
                    <span className="tabular-nums normal-case tracking-normal">
                      {formatFocusMinutes(group.focusSeconds)}
                    </span>
                  </ListGroupLabel>
                  {group.sessions.map((session) => (
                    <ListRow
                      key={`${session.completedAt}-${session.startedAt}`}
                      leading={<Timer />}
                      title={`${format(new Date(session.startedAt), "HH:mm")} – ${format(new Date(session.completedAt), "HH:mm")}`}
                      meta={formatFocusMinutes(session.duration)}
                    />
                  ))}
                </div>
              ))}
            </List>
          </>
        )}
      </PageBody>
    </Page>
  );
}
