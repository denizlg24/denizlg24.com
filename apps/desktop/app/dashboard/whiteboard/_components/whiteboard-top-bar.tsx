"use client";

import type { IWhiteboardBackground } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { ConfirmButton } from "@repo/ui/confirm-button";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/popover";
import {
  BOARD_BACKGROUND_PRESETS,
  DEFAULT_BOARD_BACKGROUND,
} from "@repo/whiteboard-render";
import type { LucideIcon } from "lucide-react";
import {
  AlignJustify,
  Ban,
  Download,
  Eraser,
  Grid3x3,
  Grip,
  Loader2,
  Palette,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { ViewState } from "@/lib/whiteboard-types";
import { ToolButton } from "./whiteboard-floating";

type BgPattern = NonNullable<IWhiteboardBackground["pattern"]>;

const PATTERNS: { value: BgPattern; icon: LucideIcon }[] = [
  { value: "none", icon: Ban },
  { value: "dots", icon: Grip },
  { value: "grid", icon: Grid3x3 },
  { value: "lines", icon: AlignJustify },
];

/** The board name in the page header; click to rename when renaming is allowed. */
export function WhiteboardTitle({
  name,
  onRename,
}: {
  name: string;
  onRename?: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  // Escape unmounts the input, whose blur would otherwise commit the draft.
  const cancelledRef = useRef(false);

  if (!onRename) return name;

  const commit = () => {
    setEditing(false);
    if (cancelledRef.current) return;
    const trimmed = draft.trim();
    if (trimmed && trimmed !== name) onRename(trimmed);
  };

  if (editing) {
    return (
      <input
        // biome-ignore lint/a11y/noAutofocus: replaces the title the owner just clicked
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") commit();
          else if (event.key === "Escape") {
            cancelledRef.current = true;
            setEditing(false);
          }
        }}
        aria-label="Board name"
        className="w-full min-w-0 bg-transparent font-semibold text-accent-strong outline-none"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        cancelledRef.current = false;
        setDraft(name);
        setEditing(true);
      }}
      className="max-w-full cursor-text truncate rounded px-1 -mx-1 text-left hover:bg-surface/70"
    >
      {name}
    </button>
  );
}

export interface WhiteboardHeaderActionsProps {
  hasChanges: boolean;
  isSaving: boolean;
  viewState: ViewState;
  selectedCount: number;
  background?: IWhiteboardBackground;
  onBackgroundChange: (bg: IWhiteboardBackground) => void;
  onSave: () => void;
  onDiscard: () => void;
  onDeleteSelected: () => void;
  onResetView: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onExportPNG: () => void;
  onClear?: () => void;
}

export function WhiteboardHeaderActions({
  hasChanges,
  isSaving,
  viewState,
  selectedCount,
  background,
  onBackgroundChange,
  onSave,
  onDiscard,
  onDeleteSelected,
  onResetView,
  onZoomIn,
  onZoomOut,
  onExportPNG,
  onClear,
}: WhiteboardHeaderActionsProps) {
  const zoomPercent = Math.round(viewState.zoom * 100);
  const bgColor = background?.color ?? DEFAULT_BOARD_BACKGROUND;
  const bgPattern: BgPattern = background?.pattern ?? "none";

  return (
    <>
      {selectedCount > 0 && (
        <ToolButton
          label={`Delete ${selectedCount} selected`}
          onClick={onDeleteSelected}
          className="hover:text-destructive"
        >
          <Trash2 />
        </ToolButton>
      )}

      <div className="hidden items-center sm:flex">
        <ToolButton label="Zoom out" onClick={onZoomOut}>
          <ZoomOut />
        </ToolButton>
        <button
          type="button"
          onClick={onResetView}
          title="Reset view"
          className="h-7 min-w-11 rounded-md text-xs tabular-nums text-muted-foreground hover:bg-surface/70 hover:text-accent-strong"
        >
          {zoomPercent}%
        </button>
        <ToolButton label="Zoom in" onClick={onZoomIn}>
          <ZoomIn />
        </ToolButton>
      </div>

      <Popover>
        <PopoverTrigger asChild>
          <ToolButton label="Background">
            <Palette />
          </ToolButton>
        </PopoverTrigger>
        <PopoverContent align="end" className="flex w-fit flex-col gap-2 p-2">
          <div className="grid grid-cols-6 gap-1.5">
            {BOARD_BACKGROUND_PRESETS.map((color) => (
              <button
                key={color}
                type="button"
                title={color}
                aria-label={color}
                onClick={() =>
                  onBackgroundChange({ color, pattern: bgPattern })
                }
                className={cn(
                  "size-5 rounded-full border transition-transform hover:scale-110",
                  bgColor.toLowerCase() === color.toLowerCase()
                    ? "border-primary ring-1 ring-primary/40"
                    : "border-border/40",
                )}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="color"
              value={bgColor}
              onChange={(event) =>
                onBackgroundChange({
                  color: event.target.value,
                  pattern: bgPattern,
                })
              }
              className="size-6 cursor-pointer rounded bg-transparent"
            />
            Custom
          </label>
          <div className="flex items-center gap-0.5">
            {PATTERNS.map(({ value, icon: Icon }) => (
              <ToolButton
                key={value}
                label={value}
                active={bgPattern === value}
                onClick={() =>
                  onBackgroundChange({ color: bgColor, pattern: value })
                }
              >
                <Icon />
              </ToolButton>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <ToolButton label="Export PNG" onClick={onExportPNG}>
        <Download />
      </ToolButton>

      {onClear && (
        <ConfirmButton
          trigger={
            <ToolButton
              label="Clear board"
              disabled={isSaving}
              className="hover:text-destructive"
            >
              <Eraser />
            </ToolButton>
          }
          title="Clear today's board?"
          actionLabel="Clear"
          destructive
          onConfirm={onClear}
        />
      )}

      <ToolButton
        label="Discard changes"
        onClick={onDiscard}
        disabled={!hasChanges || isSaving}
      >
        <Undo2 />
      </ToolButton>

      <Button
        size="sm"
        variant={hasChanges ? "default" : "ghost"}
        onClick={onSave}
        disabled={!hasChanges || isSaving}
        title="Save (Ctrl+S)"
      >
        {isSaving ? <Loader2 className="animate-spin" /> : null}
        {hasChanges ? "Save" : "Saved"}
      </Button>
    </>
  );
}
