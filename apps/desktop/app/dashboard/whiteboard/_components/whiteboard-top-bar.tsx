"use client";

import type { IWhiteboardBackground } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/popover";
import {
  BOARD_BACKGROUND_PRESETS,
  DEFAULT_BOARD_BACKGROUND,
} from "@repo/whiteboard-render";
import type { LucideIcon } from "lucide-react";
import {
  AlignJustify,
  ArrowLeft,
  Ban,
  Download,
  Eraser,
  Grid3x3,
  Grip,
  Loader2,
  Palette,
  RotateCcw,
  Save,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { ViewState } from "@/lib/whiteboard-types";

type BgPattern = NonNullable<IWhiteboardBackground["pattern"]>;

const PATTERNS: { value: BgPattern; icon: LucideIcon }[] = [
  { value: "none", icon: Ban },
  { value: "dots", icon: Grip },
  { value: "grid", icon: Grid3x3 },
  { value: "lines", icon: AlignJustify },
];

export interface WhiteboardTopBarProps {
  boardName: string;
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
  onRename?: (newName: string) => void;
  onBack?: () => void;
  onClear?: () => void;
}

export function WhiteboardTopBar({
  boardName,
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
  onRename,
  onBack,
  onClear,
}: WhiteboardTopBarProps) {
  const zoomPercent = Math.round(viewState.zoom * 100);
  const bgColor = background?.color ?? DEFAULT_BOARD_BACKGROUND;
  const bgPattern: BgPattern = background?.pattern ?? "none";
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(boardName);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleStartEdit = useCallback(() => {
    setEditValue(boardName);
    setIsEditing(true);

    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [boardName]);

  const handleCommitRename = useCallback(() => {
    const trimmed = editValue.trim();
    setIsEditing(false);
    if (trimmed && trimmed !== boardName && onRename) {
      onRename(trimmed);
    }
  }, [editValue, boardName, onRename]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        handleCommitRename();
      }
      if (e.key === "Escape") {
        setIsEditing(false);
      }
    },
    [handleCommitRename],
  );

  return (
    <div className="absolute cursor-auto top-2 left-2 right-2 z-50 mx-auto flex max-w-max flex-row items-center gap-2 overflow-x-auto rounded-full border bg-surface px-3 py-2 shadow-xs sm:left-1/2 sm:right-auto sm:-translate-x-1/2">
      {onBack && (
        <>
          <Button
            size="icon-xs"
            variant="outline"
            onClick={onBack}
            title="Back to boards"
          >
            <ArrowLeft />
          </Button>

          <div className="h-5 w-px bg-border" />
        </>
      )}

      {onRename ? (
        isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleCommitRename}
            onKeyDown={handleKeyDown}
            className="text-xs font-medium max-w-36 bg-transparent border-b border-primary outline-none text-foreground px-0.5"
          />
        ) : (
          <button
            type="button"
            onClick={handleStartEdit}
            className="text-xs text-muted-foreground font-medium max-w-28 truncate hover:text-foreground transition-colors cursor-text"
            title="Click to rename"
          >
            {boardName}
          </button>
        )
      ) : (
        <span className="text-xs text-muted-foreground font-medium max-w-28 truncate">
          {boardName}
        </span>
      )}

      <div className="h-5 w-px bg-border" />

      <Button
        size="icon-xs"
        variant={hasChanges ? "default" : "outline"}
        onClick={onSave}
        disabled={!hasChanges || isSaving}
        title="Save changes (Ctrl+S)"
      >
        {isSaving ? <Loader2 className="animate-spin" /> : <Save />}
      </Button>

      <Button
        size="icon-xs"
        variant="outline"
        onClick={onDiscard}
        disabled={!hasChanges}
        title="Discard changes"
      >
        <X />
      </Button>

      {onClear && (
        <Button
          size="icon-xs"
          variant="outline"
          onClick={onClear}
          disabled={isSaving}
          title="Clear board"
          className="text-destructive border-destructive/30 hover:bg-destructive/10"
        >
          <Eraser />
        </Button>
      )}

      {selectedCount > 0 && (
        <>
          <div className="h-5 w-px bg-border" />
          <Button
            size="icon-xs"
            variant="outline"
            onClick={onDeleteSelected}
            title={`Delete ${selectedCount} selected`}
            className="text-destructive border-destructive/30 hover:bg-destructive/10"
          >
            <Trash2 />
          </Button>
        </>
      )}

      <div className="h-5 w-px bg-border" />

      <Popover>
        <PopoverTrigger asChild>
          <Button size="icon-xs" variant="outline" title="Board background">
            <Palette />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="center"
          className="w-fit! p-2 z-99! flex flex-col gap-2"
        >
          <div className="grid grid-cols-6 gap-1.5">
            {BOARD_BACKGROUND_PRESETS.map((color) => (
              <button
                key={color}
                type="button"
                title={color}
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
          <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <input
              type="color"
              value={bgColor}
              onChange={(e) =>
                onBackgroundChange({
                  color: e.target.value,
                  pattern: bgPattern,
                })
              }
              className="size-6 rounded cursor-pointer bg-transparent"
            />
            Custom
          </label>
          <div className="flex items-center gap-1">
            {PATTERNS.map(({ value, icon: Icon }) => (
              <Button
                key={value}
                size="icon-xs"
                variant="outline"
                title={value}
                className={cn(bgPattern === value && "border-primary")}
                onClick={() =>
                  onBackgroundChange({ color: bgColor, pattern: value })
                }
              >
                <Icon />
              </Button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <Button
        size="icon-xs"
        variant="outline"
        onClick={onZoomOut}
        title="Zoom out"
      >
        <ZoomOut />
      </Button>

      <span className="text-[10px] text-muted-foreground tabular-nums min-w-8 text-center">
        {zoomPercent}%
      </span>

      <Button
        size="icon-xs"
        variant="outline"
        onClick={onZoomIn}
        title="Zoom in"
      >
        <ZoomIn />
      </Button>

      <Button
        size="icon-xs"
        variant="outline"
        onClick={onResetView}
        title="Reset view"
      >
        <RotateCcw />
      </Button>

      <div className="h-5 w-px bg-border" />

      <Button
        size="icon-xs"
        variant="outline"
        onClick={onExportPNG}
        title="Export PNG"
      >
        <Download />
      </Button>
    </div>
  );
}
