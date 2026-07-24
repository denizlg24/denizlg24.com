"use client";

import type { SelectedEntry } from "./store";

export const DRAG_MIME = "application/x-deniz-storage";

export interface DragPayload {
  sourceFolderId: string;
  entries: SelectedEntry[];
}

// `dataTransfer.getData` is unreadable during `dragover`, so drop targets need
// a side channel to decide whether to highlight themselves.
let current: DragPayload | null = null;

export function beginDrag(
  dataTransfer: DataTransfer,
  payload: DragPayload,
): void {
  current = payload;
  dataTransfer.effectAllowed = "move";
  dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
}

export function endDrag(): void {
  current = null;
}

export function activeDrag(): DragPayload | null {
  return current;
}

export function readDrop(dataTransfer: DataTransfer): DragPayload | null {
  const raw = dataTransfer.getData(DRAG_MIME);
  if (!raw) return current;
  try {
    return JSON.parse(raw) as DragPayload;
  } catch {
    return current;
  }
}

export function isFileDrag(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types).includes("Files");
}
