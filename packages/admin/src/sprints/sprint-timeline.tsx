"use client";

import {
  DndContext,
  type DragEndEvent,
  type Modifier,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { SprintSlot } from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { cn } from "@repo/ui/utils";
import {
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  isEditableSlotStatus,
  SLOT_KIND_ACCENT,
  SLOT_KIND_LABEL,
  SLOT_STATUS_BADGE,
} from "./sprint-meta";

const HOUR_HEIGHT = 60;
const PX_PER_MINUTE = HOUR_HEIGHT / 60;
const SNAP_MINUTES = 15;
/** A slot has no duration of its own; it is drawn as this long. */
const SLOT_MINUTES = 60;
const GUTTER = 56;
const MIN_DAY_WIDTH = 150;
const MIN_DAYS = 5;

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function sameDay(left: Date, right: Date): boolean {
  return startOfDay(left).getTime() === startOfDay(right).getTime();
}

function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

function pad(part: number): string {
  return `${part}`.padStart(2, "0");
}

function clock(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const DAY_LABEL = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
});

/** Days from the first slot's to the last's, never fewer than `MIN_DAYS`. */
function sprintDays(slots: SprintSlot[]): Date[] {
  const times = slots.map((slot) => new Date(slot.at).getTime());
  const first = startOfDay(
    times.length > 0 ? new Date(Math.min(...times)) : new Date(),
  );
  const last = startOfDay(
    times.length > 0 ? new Date(Math.max(...times)) : new Date(),
  );
  const days: Date[] = [];
  for (
    let day = first;
    day <= last || days.length < MIN_DAYS;
    day = addDays(day, 1)
  ) {
    days.push(day);
  }
  return days;
}

interface Placement {
  slot: SprintSlot;
  dayIndex: number;
  lane: number;
  lanes: number;
  start: number;
}

/** The timetable's overlap lanes, over a fixed-length block per slot. */
function placeSlots(slots: SprintSlot[], days: Date[]): Placement[] {
  const out: Placement[] = [];
  days.forEach((day, dayIndex) => {
    const daySlots = slots
      .filter((slot) => sameDay(new Date(slot.at), day))
      .map((slot) => ({ slot, start: minutesOfDay(new Date(slot.at)) }))
      .sort((left, right) => left.start - right.start);
    const laneEnds: number[] = [];
    const placed = daySlots.map(({ slot, start }) => {
      let lane = laneEnds.findIndex((end) => end <= start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(start + SLOT_MINUTES);
      } else {
        laneEnds[lane] = start + SLOT_MINUTES;
      }
      return { slot, dayIndex, lane, lanes: 1, start };
    });
    for (const item of placed) {
      let widest = 0;
      for (const other of placed) {
        if (
          other.start < item.start + SLOT_MINUTES &&
          item.start < other.start + SLOT_MINUTES
        ) {
          widest = Math.max(widest, other.lane);
        }
      }
      item.lanes = widest + 1;
    }
    out.push(...placed);
  });
  return out;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

function SlotBlock({
  placement,
  days,
  minHour,
  movable,
  onOpen,
  onNudge,
}: {
  placement: Placement;
  days: number;
  minHour: number;
  movable: boolean;
  onOpen: () => void;
  onNudge: (days: number, minutes: number) => void;
}) {
  const { slot, dayIndex, lane, lanes, start } = placement;
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: slot.id, disabled: !movable });
  const at = new Date(slot.at);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!movable) return;
    const step = event.shiftKey ? 60 : SNAP_MINUTES;
    const moves: Record<string, [number, number]> = {
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    onNudge(move[0], move[1]);
  };

  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      aria-roledescription={movable ? "movable slot" : "slot"}
      aria-label={`${SLOT_KIND_LABEL[slot.kind]} ${slot.title} ${clock(at)}`}
      onClick={onOpen}
      onKeyDown={onKeyDown}
      className={cn(
        "absolute z-10 flex min-w-0 flex-col gap-0.5 overflow-hidden rounded-sm border-l-2 bg-surface px-1.5 py-1 text-left text-accent-strong transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 dark:bg-muted",
        SLOT_KIND_ACCENT[slot.kind],
        movable ? "cursor-grab" : "cursor-pointer",
        isDragging && "z-30 cursor-grabbing ring-1 ring-ring/40",
        (slot.status === "skipped" || slot.status === "cancelled") &&
          "text-muted-foreground",
      )}
      style={{
        top: (start - minHour * 60) * PX_PER_MINUTE,
        height: SLOT_MINUTES * PX_PER_MINUTE - 2,
        left: `calc(${((dayIndex + lane / lanes) / days) * 100}% + 2px)`,
        width: `calc(${(1 / (days * lanes)) * 100}% - 4px)`,
        transform: CSS.Translate.toString(transform),
      }}
    >
      <span className="truncate text-[10px] leading-tight tabular-nums text-muted-foreground">
        {clock(at)} · {SLOT_KIND_LABEL[slot.kind]}
      </span>
      <span className="truncate text-xs font-medium leading-tight">
        {slot.title}
      </span>
      <Badge
        variant={SLOT_STATUS_BADGE[slot.status]}
        className={cn(
          "mt-auto h-4 px-1 text-[10px]",
          slot.status === "running" && "animate-pulse",
        )}
      >
        {slot.status}
      </Badge>
    </button>
  );
}

/**
 * The sprint laid out by date: a column per day and an hour grid, slots as
 * blocks and their dependencies as hairlines from upstream to downstream.
 * Empty space creates a slot at the time clicked; a scheduled slot drags (or
 * arrow-keys) in 15-minute steps.
 */
export function SprintTimeline({
  slots,
  editable,
  onCreateAt,
  onOpenSlot,
  onMoveSlot,
}: {
  slots: SprintSlot[];
  editable: boolean;
  onCreateAt: (at: Date) => void;
  onOpenSlot: (slot: SprintSlot) => void;
  onMoveSlot: (slot: SprintSlot, at: Date) => void;
}) {
  const days = useMemo(() => sprintDays(slots), [slots]);
  const placements = useMemo(() => placeSlots(slots, days), [slots, days]);
  const { ref: areaRef, width } = useWidth<HTMLDivElement>();
  const dayWidth = days.length > 0 ? width / days.length : 0;

  const { minHour, maxHour } = useMemo(() => {
    let min = 8;
    let max = 20;
    for (const placement of placements) {
      min = Math.min(min, Math.floor(placement.start / 60));
      max = Math.max(max, Math.ceil((placement.start + SLOT_MINUTES) / 60));
    }
    return { minHour: min, maxHour: Math.min(max, 24) };
  }, [placements]);
  const hours = Array.from(
    { length: maxHour - minHour },
    (_, index) => minHour + index,
  );
  const height = hours.length * HOUR_HEIGHT;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const snap: Modifier = ({ transform }) => ({
    ...transform,
    x: dayWidth > 0 ? Math.round(transform.x / dayWidth) * dayWidth : 0,
    y:
      Math.round(transform.y / (SNAP_MINUTES * PX_PER_MINUTE)) *
      SNAP_MINUTES *
      PX_PER_MINUTE,
  });

  const move = (slot: SprintSlot, dayDelta: number, minuteDelta: number) => {
    if (dayDelta === 0 && minuteDelta === 0) return;
    const next = addDays(new Date(slot.at), dayDelta);
    next.setMinutes(next.getMinutes() + minuteDelta);
    onMoveSlot(slot, next);
  };

  // The pointer-up that ends a drag also clicks the block it lands on.
  const draggedAt = useRef(0);

  const onDragEnd = ({ active, delta }: DragEndEvent) => {
    draggedAt.current = Date.now();
    const slot = slots.find((candidate) => candidate.id === active.id);
    if (!slot || dayWidth <= 0) return;
    move(
      slot,
      Math.round(delta.x / dayWidth),
      Math.round(delta.y / PX_PER_MINUTE / SNAP_MINUTES) * SNAP_MINUTES,
    );
  };

  const createAt = (day: Date, event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const offset = Math.max(0, event.clientY - rect.top);
    const minutes =
      minHour * 60 +
      Math.floor(offset / PX_PER_MINUTE / SNAP_MINUTES) * SNAP_MINUTES;
    const at = new Date(day);
    at.setMinutes(minutes);
    onCreateAt(at);
  };

  const boxes = new Map(
    placements.map((placement) => {
      const laneWidth = dayWidth / placement.lanes;
      const left = placement.dayIndex * dayWidth + placement.lane * laneWidth;
      return [
        placement.slot.id,
        {
          x: left + laneWidth / 2,
          top: (placement.start - minHour * 60) * PX_PER_MINUTE,
          bottom:
            (placement.start - minHour * 60 + SLOT_MINUTES) * PX_PER_MINUTE,
        },
      ];
    }),
  );
  const edges = slots.flatMap((slot) =>
    slot.dependsOn.flatMap((upstreamId) => {
      const from = boxes.get(upstreamId);
      const to = boxes.get(slot.id);
      return from && to ? [{ id: `${upstreamId}-${slot.id}`, from, to }] : [];
    }),
  );

  const now = new Date();
  const todayIndex = days.findIndex((day) => sameDay(day, now));
  const nowTop = (minutesOfDay(now) - minHour * 60) * PX_PER_MINUTE;

  return (
    <div className="overflow-x-auto border-y">
      <div
        className="grid"
        style={{
          gridTemplateColumns: `${GUTTER}px minmax(0, 1fr)`,
          minWidth: GUTTER + days.length * MIN_DAY_WIDTH,
        }}
      >
        <div className="sticky left-0 z-40 border-r border-b bg-background" />
        <div className="flex border-b">
          {days.map((day, index) => (
            <div
              key={day.getTime()}
              className={cn(
                "min-w-0 flex-1 border-r px-2 py-1.5 text-center text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground last:border-r-0",
                index === todayIndex && "text-accent-strong",
              )}
            >
              {DAY_LABEL.format(day)}
            </div>
          ))}
        </div>

        <div className="sticky left-0 z-40 border-r bg-background">
          {hours.map((hour) => (
            <div
              key={hour}
              className="flex items-start justify-end border-b pt-1 pr-2 text-[11px] tabular-nums text-muted-foreground last:border-b-0"
              style={{ height: HOUR_HEIGHT }}
            >
              {pad(hour)}:00
            </div>
          ))}
        </div>

        <DndContext sensors={sensors} modifiers={[snap]} onDragEnd={onDragEnd}>
          <div ref={areaRef} className="relative flex" style={{ height }}>
            {days.map((day, index) => (
              <div
                key={day.getTime()}
                className={cn(
                  "relative min-w-0 flex-1 border-r last:border-r-0",
                  index === todayIndex && "bg-surface/30",
                )}
              >
                {hours.map((hour, hourIndex) => (
                  <div
                    key={hour}
                    className="pointer-events-none absolute w-full border-b border-border/60"
                    style={{
                      top: hourIndex * HOUR_HEIGHT,
                      height: HOUR_HEIGHT,
                    }}
                  />
                ))}
                {editable ? (
                  <button
                    type="button"
                    aria-label={`New slot on ${DAY_LABEL.format(day)}`}
                    className="absolute inset-0 cursor-cell focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30"
                    onClick={(event) => createAt(day, event)}
                  />
                ) : null}
              </div>
            ))}

            {todayIndex >= 0 && nowTop >= 0 && nowTop <= height ? (
              <div
                aria-hidden
                className="pointer-events-none absolute z-20 h-px bg-status-critical/70"
                style={{
                  top: nowTop,
                  left: `${(todayIndex / days.length) * 100}%`,
                  width: `${(1 / days.length) * 100}%`,
                }}
              />
            ) : null}

            {width > 0 && edges.length > 0 ? (
              <svg
                aria-hidden
                className="pointer-events-none absolute inset-0 z-[5] text-muted-foreground/60"
                width={width}
                height={height}
              >
                {edges.map(({ id, from, to }) => {
                  const bend = Math.max(16, Math.abs(to.top - from.bottom) / 2);
                  return (
                    <g key={id}>
                      <path
                        d={`M ${from.x} ${from.bottom} C ${from.x} ${
                          from.bottom + bend
                        }, ${to.x} ${to.top - bend}, ${to.x} ${to.top}`}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1}
                      />
                      <circle cx={to.x} cy={to.top} r={2} fill="currentColor" />
                    </g>
                  );
                })}
              </svg>
            ) : null}

            {placements.map((placement) => (
              <SlotBlock
                key={placement.slot.id}
                placement={placement}
                days={days.length}
                minHour={minHour}
                movable={
                  editable && isEditableSlotStatus(placement.slot.status)
                }
                onOpen={() => {
                  if (Date.now() - draggedAt.current > 250) {
                    onOpenSlot(placement.slot);
                  }
                }}
                onNudge={(dayDelta, minuteDelta) =>
                  move(placement.slot, dayDelta, minuteDelta)
                }
              />
            ))}
          </div>
        </DndContext>
      </div>
    </div>
  );
}
