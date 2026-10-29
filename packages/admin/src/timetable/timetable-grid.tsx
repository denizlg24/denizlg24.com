"use client";

import type { ITimetableEntry, TimetableColor } from "@repo/schemas";
import { cn } from "@repo/ui/utils";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const TIMETABLE_COLOR_CLASSES: Record<
  TimetableColor,
  { bg: string; text: string }
> = {
  background: { bg: "bg-background", text: "text-accent-strong" },
  surface: { bg: "bg-surface", text: "text-accent-strong" },
  muted: { bg: "bg-muted", text: "text-accent-strong" },
  accent: { bg: "bg-accent", text: "text-accent-strong" },
  "accent-strong": { bg: "bg-accent-strong", text: "text-background" },
  foreground: { bg: "bg-foreground", text: "text-background" },
  destructive: { bg: "bg-destructive", text: "text-background" },
};

function timeToMinutes(time: string): number {
  const [h = 0, m = 0] = time.split(":").map(Number);
  return h * 60 + m;
}

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

interface OverlapGroup {
  entry: ITimetableEntry;
  columnIndex: number;
  totalColumns: number;
}

function computeOverlapLayout(entries: ITimetableEntry[]): OverlapGroup[] {
  if (entries.length === 0) return [];

  const sorted = [...entries].sort(
    (a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime),
  );

  const result: OverlapGroup[] = [];
  const columns: { end: number }[] = [];

  for (const entry of sorted) {
    const start = timeToMinutes(entry.startTime);
    const end = timeToMinutes(entry.endTime);
    const free = columns.findIndex((column) => column.end <= start);
    if (free === -1) {
      columns.push({ end });
      result.push({ entry, columnIndex: columns.length - 1, totalColumns: 0 });
    } else {
      columns[free] = { end };
      result.push({ entry, columnIndex: free, totalColumns: 0 });
    }
  }

  for (const item of result) {
    const entryStart = timeToMinutes(item.entry.startTime);
    const entryEnd = timeToMinutes(item.entry.endTime);

    let maxCol = 0;
    for (const other of result) {
      const otherStart = timeToMinutes(other.entry.startTime);
      const otherEnd = timeToMinutes(other.entry.endTime);
      if (otherStart < entryEnd && entryStart < otherEnd) {
        maxCol = Math.max(maxCol, other.columnIndex);
      }
    }
    item.totalColumns = maxCol + 1;
  }

  return result;
}

interface TimetableGridProps {
  entries: ITimetableEntry[];
  onEntryClick?: (entry: ITimetableEntry) => void;
}

const HOUR_HEIGHT = 60;

export function TimetableGrid({ entries, onEntryClick }: TimetableGridProps) {
  let minHour = 8;
  let maxHour = 23;

  if (entries.length > 0) {
    const earliest = Math.min(
      ...entries.map((e) => timeToMinutes(e.startTime)),
    );
    const latest = Math.max(...entries.map((e) => timeToMinutes(e.endTime)));
    minHour = Math.min(minHour, Math.floor(earliest / 60));
    maxHour = Math.max(maxHour, Math.ceil(latest / 60));
  }

  const hours = Array.from(
    { length: maxHour - minHour },
    (_, i) => minHour + i,
  );

  const layoutByDay = DAYS.map((_, dayIndex) =>
    computeOverlapLayout(entries.filter((e) => e.dayOfWeek === dayIndex)),
  );

  const todayIndex = (new Date().getDay() + 6) % 7;

  return (
    <div className="overflow-x-auto rounded-md border">
      <div
        className="grid min-w-225"
        style={{ gridTemplateColumns: "56px repeat(7, 1fr)" }}
      >
        <div className="sticky left-0 z-20 border-r border-b bg-background" />
        {DAYS.map((day, index) => (
          <div
            key={day}
            className={cn(
              "border-r border-b px-2 py-1.5 text-center text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground last:border-r-0",
              index === todayIndex && "text-accent-strong",
            )}
          >
            {day}
          </div>
        ))}

        <div className="sticky left-0 z-20 border-r bg-background">
          {hours.map((hour) => (
            <div
              key={hour}
              className="flex items-start justify-end border-b pt-1 pr-2 text-[11px] tabular-nums text-muted-foreground last:border-b-0"
              style={{ height: HOUR_HEIGHT }}
            >
              {formatHour(hour)}
            </div>
          ))}
        </div>

        {DAYS.map((day, dayIndex) => (
          <div
            key={day}
            className={cn(
              "relative border-r last:border-r-0",
              dayIndex === todayIndex && "bg-surface/30",
            )}
            style={{ height: hours.length * HOUR_HEIGHT }}
          >
            {hours.map((hour, index) => (
              <div
                key={hour}
                className={cn(
                  "pointer-events-none absolute w-full border-b border-border/60",
                  index === hours.length - 1 && "border-b-0",
                )}
                style={{
                  top: (hour - minHour) * HOUR_HEIGHT,
                  height: HOUR_HEIGHT,
                }}
              />
            ))}

            {layoutByDay[dayIndex].map(
              ({ entry, columnIndex, totalColumns }) => {
                const startMin = timeToMinutes(entry.startTime);
                const endMin = timeToMinutes(entry.endTime);
                const top = ((startMin - minHour * 60) / 60) * HOUR_HEIGHT;
                const height = ((endMin - startMin) / 60) * HOUR_HEIGHT;
                const widthPercent = 100 / totalColumns;
                const colors =
                  TIMETABLE_COLOR_CLASSES[entry.color] ??
                  TIMETABLE_COLOR_CLASSES.accent;

                return (
                  <button
                    key={entry._id}
                    type="button"
                    onClick={() => onEntryClick?.(entry)}
                    disabled={!onEntryClick}
                    className={cn(
                      "absolute z-10 flex min-w-0 flex-col overflow-hidden rounded-sm border-l-2 border-current/30 text-left transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                      colors.bg,
                      colors.text,
                      !entry.isActive &&
                        "border border-dashed border-current/40 opacity-40 hover:opacity-60",
                    )}
                    style={{
                      top,
                      height: Math.max(height, 18),
                      left: `${columnIndex * widthPercent}%`,
                      width: `${widthPercent}%`,
                    }}
                  >
                    <span className="w-full shrink-0 truncate px-1.5 pt-1 text-[10px] leading-tight tabular-nums opacity-70">
                      {entry.startTime}–{entry.endTime}
                    </span>
                    <span className="flex min-h-0 w-full min-w-0 flex-1 flex-col justify-between overflow-hidden px-1.5 py-0.5">
                      <span className="w-full truncate text-xs font-medium leading-tight">
                        {entry.title}
                      </span>
                      {entry.place && (
                        <span className="w-full truncate text-[10px] leading-tight opacity-70">
                          {entry.place}
                        </span>
                      )}
                    </span>
                  </button>
                );
              },
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
