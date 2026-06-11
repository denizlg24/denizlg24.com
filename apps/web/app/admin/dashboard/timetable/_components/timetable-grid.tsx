"use client";

import type {
  ILeanTimetableEntry,
  TimetableColor,
} from "@/lib/timetable-constants";
import { cn } from "@/lib/utils";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const COLOR_MAP: Record<TimetableColor, { bg: string; text: string }> = {
  background: {
    bg: "bg-[var(--background)]",
    text: "text-[var(--accent-strong)]",
  },
  surface: { bg: "bg-[var(--surface)]", text: "text-[var(--accent-strong)]" },
  muted: { bg: "bg-[var(--muted)]", text: "text-[var(--accent-strong)]" },
  accent: { bg: "bg-[var(--accent)]", text: "text-[var(--accent-strong)]" },
  "accent-strong": {
    bg: "bg-[var(--accent-strong)]",
    text: "text-[var(--background)]",
  },
  foreground: {
    bg: "bg-[var(--foreground)]",
    text: "text-[var(--background)]",
  },
  destructive: { bg: "bg-[var(--destructive)]", text: "text-white" },
};

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

interface OverlapGroup {
  entry: ILeanTimetableEntry;
  columnIndex: number;
  totalColumns: number;
}

function computeOverlapLayout(entries: ILeanTimetableEntry[]): OverlapGroup[] {
  if (entries.length === 0) return [];

  const sorted = [...entries].sort(
    (a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime),
  );

  const result: OverlapGroup[] = [];
  const columns: { end: number; entries: ILeanTimetableEntry[] }[] = [];

  for (const entry of sorted) {
    const start = timeToMinutes(entry.startTime);

    let placed = false;
    for (let col = 0; col < columns.length; col++) {
      if (columns[col].end <= start) {
        columns[col].end = timeToMinutes(entry.endTime);
        columns[col].entries.push(entry);
        result.push({ entry, columnIndex: col, totalColumns: 0 });
        placed = true;
        break;
      }
    }

    if (!placed) {
      columns.push({
        end: timeToMinutes(entry.endTime),
        entries: [entry],
      });
      result.push({
        entry,
        columnIndex: columns.length - 1,
        totalColumns: 0,
      });
    }
  }

  // For each entry, find how many columns overlap with it
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
  entries: ILeanTimetableEntry[];
  onEntryClick: (entry: ILeanTimetableEntry) => void;
}

export function TimetableGrid({ entries, onEntryClick }: TimetableGridProps) {
  const activeEntries = entries.filter((e) => e.isActive);

  // Determine time range
  let minHour = 8;
  let maxHour = 22;

  if (activeEntries.length > 0) {
    const earliest = Math.min(
      ...activeEntries.map((e) => timeToMinutes(e.startTime)),
    );
    const latest = Math.max(
      ...activeEntries.map((e) => timeToMinutes(e.endTime)),
    );
    minHour = Math.min(minHour, Math.floor(earliest / 60));
    maxHour = Math.max(maxHour, Math.ceil(latest / 60));
  }

  const hours = Array.from(
    { length: maxHour - minHour },
    (_, i) => minHour + i,
  );
  const totalMinutes = (maxHour - minHour) * 60;
  const hourHeight = 60; // px per hour

  // Group entries by day
  const entriesByDay = DAYS.map((_, dayIndex) =>
    activeEntries.filter((e) => e.dayOfWeek === dayIndex),
  );

  const layoutByDay = entriesByDay.map((dayEntries) =>
    computeOverlapLayout(dayEntries),
  );

  return (
    <div className="overflow-x-auto border rounded-lg">
      <div
        className="grid min-w-225"
        style={{ gridTemplateColumns: "60px repeat(7, 1fr)" }}
      >
        <div className="sticky left-0 z-10 bg-background border-b border-r p-2" />
        {DAYS.map((day) => (
          <div
            key={day}
            className="border-b border-r last:border-r-0 p-2 text-center font-medium text-sm"
          >
            {day}
          </div>
        ))}

        <div className="sticky left-0 z-10 bg-background border-r">
          {hours.map((hour) => (
            <div
              key={hour}
              className="border-b last:border-b-0 text-xs text-muted-foreground flex items-start justify-end pr-2 pt-1"
              style={{ height: hourHeight }}
            >
              {formatHour(hour)}
            </div>
          ))}
        </div>

        {DAYS.map((day, dayIndex) => (
          <div
            key={day}
            className="relative border-r last:border-r-0"
            style={{ height: hours.length * hourHeight }}
          >
            {hours.map((hour) => (
              <div
                key={hour}
                className="absolute w-full border-b"
                style={{
                  top: (hour - minHour) * hourHeight,
                  height: hourHeight,
                }}
              />
            ))}

            {layoutByDay[dayIndex].map(
              ({ entry, columnIndex, totalColumns }) => {
                const startMin = timeToMinutes(entry.startTime);
                const endMin = timeToMinutes(entry.endTime);
                const top =
                  ((startMin - minHour * 60) / totalMinutes) *
                  hours.length *
                  hourHeight;
                const height =
                  ((endMin - startMin) / totalMinutes) *
                  hours.length *
                  hourHeight;
                const widthPercent = 100 / totalColumns;
                const leftPercent = columnIndex * widthPercent;
                const colors = COLOR_MAP[entry.color] || COLOR_MAP.accent;

                return (
                  <button
                    key={entry._id}
                    type="button"
                    onClick={() => onEntryClick(entry)}
                    className={cn(
                      "absolute border-l-2 border-black/20 overflow-hidden cursor-pointer transition-opacity hover:opacity-80 flex flex-col",
                      colors.bg,
                      colors.text,
                    )}
                    style={{
                      top,
                      height: Math.max(height, 18),
                      left: `calc(${leftPercent}%)`,
                      width: `calc(${widthPercent}%)`,
                    }}
                  >
                    <div className="text-[10px] leading-tight opacity-80 text-left px-1.5 pt-1 pb-0.5 bg-black/10">
                      {entry.startTime}–{entry.endTime}
                    </div>
                    <div className="flex-1 flex flex-col justify-between px-1.5 py-0.5 min-h-0">
                      <div className="text-xs font-semibold leading-tight truncate text-left">
                        {entry.title}
                      </div>
                      {entry.place && (
                        <div className="text-[10px] leading-tight opacity-60 truncate text-left">
                          {entry.place}
                        </div>
                      )}
                    </div>
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
