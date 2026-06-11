"use client";

import {
  ArrowLeft,
  Download,
  Eraser,
  Loader2,
  RotateCcw,
  Save,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ViewState } from "@/lib/whiteboard-types";

export interface WhiteboardTopBarProps {
  boardName: string;
  hasChanges: boolean;
  isSaving: boolean;
  viewState: ViewState;
  selectedCount: number;
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
    <div className="absolute cursor-auto top-2 left-1/2 -translate-x-1/2 z-50 border bg-surface shadow-xs rounded-full py-2 px-3 flex flex-row items-center gap-2">
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
