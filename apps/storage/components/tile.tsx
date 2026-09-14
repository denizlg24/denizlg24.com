"use client";

import { Checkbox } from "@repo/ui/checkbox";
import { cn } from "@repo/ui/utils";
import { Check, type LucideIcon } from "lucide-react";
import {
  type ComponentProps,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import { Thumbnail } from "./thumbnail";

export type Density = "comfortable" | "compact";

/** Seconds until a moment, re-rendered every second while it is ahead. */
export function useCountdown(until: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [until]);
  return until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1_000));
}

/**
 * One item of a grid: the thumbnail (or a large coloured glyph), the name on
 * up to two lines, and one muted line. Selection is a ring plus a filled check;
 * a row mid-delete is dimmed with its countdown; a row the server has not
 * confirmed yet is faded. It knows nothing about folders or files — the
 * browser, search, recent and the share page all feed it.
 */
export function Tile({
  name,
  meta,
  icon: Icon,
  iconClassName,
  thumbnailSrc,
  badge,
  density,
  selected = false,
  focused = false,
  selectionMode = false,
  pending = false,
  deleteAt = null,
  onUndoDelete,
  onToggleSelect,
  nameSlot,
  menu,
  className,
  children,
  ...rest
}: {
  name: string;
  meta: ReactNode;
  icon: LucideIcon;
  iconClassName?: string;
  thumbnailSrc: string | null;
  badge?: ReactNode;
  density: Density;
  selected?: boolean;
  focused?: boolean;
  /** Every tile shows its checkbox (touch selection mode). */
  selectionMode?: boolean;
  pending?: boolean;
  deleteAt?: number | null;
  onUndoDelete?: () => void;
  onToggleSelect?: () => void;
  /** Replaces the name, e.g. an inline rename field. */
  nameSlot?: ReactNode;
  /** The `⋯` control. */
  menu?: ReactNode;
} & ComponentProps<"li">) {
  const seconds = useCountdown(deleteAt);
  const deleting = deleteAt !== null;
  const compact = density === "compact";

  return (
    <li
      {...rest}
      data-selected={selected}
      className={cn(
        "select-none-drag group relative flex cursor-default flex-col gap-1.5 rounded-xl transition-[background-color,box-shadow] duration-150 ease-out",
        compact ? "p-1.5" : "p-2",
        selected ? "bg-muted/60 ring-2 ring-primary" : "hover:bg-muted/40",
        focused && !selected && "ring-1 ring-ring/50",
        pending && "opacity-60",
        deleting && "opacity-50",
        className,
      )}
    >
      <div className="relative">
        <Thumbnail
          src={thumbnailSrc}
          alt=""
          fallback={Icon}
          className={cn("w-full", compact ? "aspect-square" : "aspect-[4/3]")}
          iconClassName={cn(compact ? "size-8" : "size-10", iconClassName)}
        />
        {badge && (
          <span className="absolute bottom-1.5 left-1.5 rounded-md bg-background/85 px-1.5 py-0.5 text-[11px] font-medium tabular-nums backdrop-blur">
            {badge}
          </span>
        )}
        {onToggleSelect && (
          <div
            data-visible={selected || selectionMode}
            className={cn(
              "absolute left-1.5 top-1.5 transition-opacity duration-150",
              "opacity-0 focus-within:opacity-100 group-hover:opacity-100 data-[visible=true]:opacity-100",
            )}
          >
            {selected ? (
              <button
                type="button"
                aria-label={`Deselect ${name}`}
                className="flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow"
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleSelect();
                }}
              >
                <Check className="size-3.5" strokeWidth={3} />
              </button>
            ) : (
              <Checkbox
                checked={false}
                aria-label={`Select ${name}`}
                className="size-6 rounded-full bg-background/90 shadow"
                onClick={(event) => event.stopPropagation()}
                onCheckedChange={() => onToggleSelect()}
              />
            )}
          </div>
        )}
        {menu && (
          <div className="absolute right-1 top-1 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100 has-[[data-state=open]]:opacity-100">
            {menu}
          </div>
        )}
      </div>
      <div className="min-w-0 px-0.5">
        {nameSlot ?? (
          <p
            className={cn(
              "line-clamp-2 break-words leading-snug",
              compact ? "text-xs" : "text-sm",
            )}
            title={name}
          >
            {name}
          </p>
        )}
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {deleting ? (
            <>
              Deleting in {seconds}s
              {onUndoDelete && (
                <>
                  {" · "}
                  <button
                    type="button"
                    className="font-medium text-foreground underline-offset-2 hover:underline"
                    onClick={(event) => {
                      event.stopPropagation();
                      onUndoDelete();
                    }}
                  >
                    Undo
                  </button>
                </>
              )}
            </>
          ) : pending ? (
            "Saving…"
          ) : (
            meta
          )}
        </p>
      </div>
      {children}
    </li>
  );
}

/** A tile-shaped placeholder for a file still uploading into this folder. */
export function GhostTile({
  name,
  percent,
  status,
  density,
  onPause,
  onResume,
  onCancel,
}: {
  name: string;
  percent: number;
  status: "queued" | "uploading" | "paused" | "error";
  density: Density;
  onPause?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
}) {
  const compact = density === "compact";
  const circumference = 2 * Math.PI * 16;
  return (
    <li
      className={cn(
        "group relative flex flex-col gap-1.5 rounded-xl border border-dashed",
        compact ? "p-1.5" : "p-2",
        status === "error" ? "border-destructive/50" : "border-border",
      )}
      aria-busy={status === "uploading"}
    >
      <div
        className={cn(
          "flex w-full items-center justify-center rounded-lg bg-muted/30",
          compact ? "aspect-square" : "aspect-[4/3]",
        )}
      >
        <svg viewBox="0 0 40 40" className="size-12" aria-hidden="true">
          <circle
            cx="20"
            cy="20"
            r="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            className="text-border"
          />
          <circle
            cx="20"
            cy="20"
            r="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - percent / 100)}
            transform="rotate(-90 20 20)"
            className={cn(
              "transition-[stroke-dashoffset] duration-300",
              status === "error" ? "text-destructive" : "text-primary",
            )}
          />
        </svg>
        <div className="absolute right-1 top-1 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {status === "uploading" && onPause && (
            <button
              type="button"
              className="rounded-md bg-background/90 px-1.5 py-0.5 text-[11px] shadow"
              onClick={onPause}
            >
              Pause
            </button>
          )}
          {(status === "paused" || status === "error") && onResume && (
            <button
              type="button"
              className="rounded-md bg-background/90 px-1.5 py-0.5 text-[11px] shadow"
              onClick={onResume}
            >
              {status === "error" ? "Retry" : "Resume"}
            </button>
          )}
          {onCancel && (
            <button
              type="button"
              className="rounded-md bg-background/90 px-1.5 py-0.5 text-[11px] shadow"
              onClick={onCancel}
            >
              Cancel
            </button>
          )}
        </div>
      </div>
      <div className="min-w-0 px-0.5">
        <p
          className={cn(
            "line-clamp-2 break-words leading-snug",
            compact ? "text-xs" : "text-sm",
          )}
          title={name}
        >
          {name}
        </p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {status === "error"
            ? "Upload failed"
            : status === "paused"
              ? "Paused"
              : status === "queued"
                ? "Waiting…"
                : `Uploading · ${Math.round(percent)}%`}
        </p>
      </div>
    </li>
  );
}
