"use client";

import type { SprintSlot, SprintSlotKind } from "@repo/schemas";
import { SPRINT_SLOT_KINDS } from "@repo/schemas";
import {
  PromptInputActionMenu,
  PromptInputActionMenuCheckboxItem,
  PromptInputActionMenuContent,
  PromptInputActionMenuLabel,
  PromptInputActionMenuRadioGroup,
  PromptInputActionMenuRadioItem,
} from "@repo/ui/ai-elements/prompt-input";
import { Calendar } from "@repo/ui/calendar";
import { DropdownMenuTrigger } from "@repo/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/popover";
import { cn } from "@repo/ui/utils";
import { CalendarClock, GitFork, Hourglass } from "lucide-react";
import { useState } from "react";
import { ComposerPill } from "./run-composer";
import {
  formatAbsolute,
  SLOT_KIND_DOT,
  SLOT_KIND_LABEL,
  SLOT_STATUS_TONE,
} from "./sprint-meta";

function KindDot({ kind }: { kind: SprintSlotKind }) {
  return (
    <span className={cn("size-2 shrink-0 rounded-full", SLOT_KIND_DOT[kind])} />
  );
}

export function KindPill({
  value,
  onChange,
  disabled,
}: {
  value: SprintSlotKind;
  onChange: (kind: SprintSlotKind) => void;
  disabled: boolean;
}) {
  return (
    <PromptInputActionMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <ComposerPill
          aria-label="Kind"
          icon={<KindDot kind={value} />}
          label={SLOT_KIND_LABEL[value]}
          set
          disabled={disabled}
        />
      </DropdownMenuTrigger>
      <PromptInputActionMenuContent side="bottom" className="w-44">
        <PromptInputActionMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            const kind = SPRINT_SLOT_KINDS.find((entry) => entry === next);
            if (kind) onChange(kind);
          }}
        >
          {SPRINT_SLOT_KINDS.map((kind) => (
            <PromptInputActionMenuRadioItem key={kind} value={kind}>
              <KindDot kind={kind} />
              {SLOT_KIND_LABEL[kind]}
            </PromptInputActionMenuRadioItem>
          ))}
        </PromptInputActionMenuRadioGroup>
      </PromptInputActionMenuContent>
    </PromptInputActionMenu>
  );
}

const pad = (part: number) => `${part}`.padStart(2, "0");

export function WhenPill({
  value,
  onChange,
  disabled,
}: {
  value: Date;
  onChange: (at: Date) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const time = `${pad(value.getHours())}:${pad(value.getMinutes())}`;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <ComposerPill
          aria-label="Time"
          icon={<CalendarClock />}
          label={<span className="tabular-nums">{formatAbsolute(value)}</span>}
          set
          disabled={disabled}
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={value}
          defaultMonth={value}
          onSelect={(day) => {
            if (!day) return;
            const next = new Date(day);
            next.setHours(value.getHours(), value.getMinutes(), 0, 0);
            onChange(next);
          }}
        />
        <div className="flex items-center gap-2 border-t px-3 py-2">
          <span className="text-xs text-muted-foreground">Time</span>
          <input
            type="time"
            value={time}
            className="ml-auto rounded-md bg-surface/60 px-2 py-1 text-xs tabular-nums outline-none"
            onChange={(event) => {
              const [hours, minutes] = event.target.value
                .split(":")
                .map(Number);
              if (hours === undefined || minutes === undefined) return;
              if (Number.isNaN(hours) || Number.isNaN(minutes)) return;
              const next = new Date(value);
              next.setHours(hours, minutes, 0, 0);
              onChange(next);
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function UpstreamPill({
  candidates,
  value,
  onToggle,
  disabled,
}: {
  candidates: SprintSlot[];
  value: string[];
  onToggle: (id: string, checked: boolean) => void;
  disabled: boolean;
}) {
  const chosen = candidates.filter((slot) => value.includes(slot.id));
  const label =
    chosen.length === 0
      ? "No upstream"
      : chosen.length === 1
        ? `After ${chosen[0]?.title}`
        : `After ${chosen.length} slots`;
  return (
    <PromptInputActionMenu>
      <DropdownMenuTrigger
        asChild
        disabled={disabled || candidates.length === 0}
      >
        <ComposerPill
          aria-label="Depends on"
          icon={<GitFork />}
          label={label}
          set={chosen.length > 0}
          disabled={disabled || candidates.length === 0}
          className="max-w-64"
        />
      </DropdownMenuTrigger>
      <PromptInputActionMenuContent
        side="bottom"
        className="w-80 max-w-[calc(100vw-1.5rem)]"
      >
        <PromptInputActionMenuLabel>Runs after</PromptInputActionMenuLabel>
        {candidates.map((slot) => (
          <PromptInputActionMenuCheckboxItem
            key={slot.id}
            checked={value.includes(slot.id)}
            onCheckedChange={(checked) => onToggle(slot.id, checked === true)}
          >
            <KindDot kind={slot.kind} />
            <span className="min-w-0 flex-1 truncate">{slot.title}</span>
            <span
              className={cn(
                "shrink-0 text-[10px] tabular-nums",
                SLOT_STATUS_TONE[slot.status],
              )}
            >
              {formatAbsolute(slot.at)}
            </span>
          </PromptInputActionMenuCheckboxItem>
        ))}
      </PromptInputActionMenuContent>
    </PromptInputActionMenu>
  );
}

const WAIT_PRESETS = [0, 30, 60, 120, 240, 480, 1440];

function formatWait(minutes: number): string {
  if (minutes === 0) return "Don't wait";
  if (minutes < 60) return `Wait ${minutes}m`;
  if (minutes % 1440 === 0) return `Wait ${minutes / 1440}d`;
  if (minutes % 60 === 0) return `Wait ${minutes / 60}h`;
  return `Wait ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** How long a slot waits for an upstream that is still running before it skips. */
export function WaitPill({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (minutes: number) => void;
  disabled: boolean;
}) {
  const options = [...new Set([...WAIT_PRESETS, value])].sort(
    (left, right) => left - right,
  );
  return (
    <PromptInputActionMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <ComposerPill
          aria-label="Upstream wait"
          title="While an upstream is still running"
          icon={<Hourglass />}
          label={formatWait(value)}
          set
          disabled={disabled}
        />
      </DropdownMenuTrigger>
      <PromptInputActionMenuContent side="bottom" className="w-48">
        <PromptInputActionMenuLabel>
          Upstream still running
        </PromptInputActionMenuLabel>
        <PromptInputActionMenuRadioGroup
          value={String(value)}
          onValueChange={(next) => onChange(Number(next))}
        >
          {options.map((minutes) => (
            <PromptInputActionMenuRadioItem
              key={minutes}
              value={String(minutes)}
            >
              {formatWait(minutes)}
            </PromptInputActionMenuRadioItem>
          ))}
        </PromptInputActionMenuRadioGroup>
      </PromptInputActionMenuContent>
    </PromptInputActionMenu>
  );
}
