"use client";

import type { IWhiteboardBackground } from "@repo/schemas";
import { type SetStateAction, useCallback, useRef, useState } from "react";
import type { IWhiteboardElement } from "@/lib/data-types";
import type { HistoryEntry } from "@/lib/whiteboard-types";

const MAX_HISTORY = 200;

export function useWhiteboardHistory(initialElements: IWhiteboardElement[]) {
  const [elements, setElementsState] =
    useState<IWhiteboardElement[]>(initialElements);
  /* The ref is the source of truth so pointer handlers read the board as it is
     now, not as of their last render, and so history is pushed outside state
     updaters (which StrictMode runs twice). */
  const elementsRef = useRef(initialElements);
  const undoStack = useRef<HistoryEntry[]>([]);
  const redoStack = useRef<HistoryEntry[]>([]);
  const backgroundApplier = useRef<
    ((bg: IWhiteboardBackground) => void) | null
  >(null);

  const [revision, setRevision] = useState(0);

  const canUndo = undoStack.current.length > 0;
  const canRedo = redoStack.current.length > 0;

  const setBackgroundApplier = useCallback(
    (fn: (bg: IWhiteboardBackground) => void) => {
      backgroundApplier.current = fn;
    },
    [],
  );

  const setElements = useCallback(
    (action: SetStateAction<IWhiteboardElement[]>) => {
      const next =
        typeof action === "function" ? action(elementsRef.current) : action;
      elementsRef.current = next;
      setElementsState(next);
    },
    [],
  );

  const getElements = useCallback(() => elementsRef.current, []);

  const pushAction = useCallback((entry: HistoryEntry) => {
    undoStack.current.push(entry);
    if (undoStack.current.length > MAX_HISTORY) {
      undoStack.current.shift();
    }
    redoStack.current = [];
    setRevision((r) => r + 1);
  }, []);

  const addElements = useCallback(
    (newEls: IWhiteboardElement[]) => {
      if (newEls.length === 0) return;
      pushAction({ type: "add", before: [], after: newEls });
      setElements([...elementsRef.current, ...newEls]);
    },
    [pushAction, setElements],
  );

  const removeElements = useCallback(
    (ids: Set<string>) => {
      const prev = elementsRef.current;
      const removed = prev.filter((el) => ids.has(el.id));
      if (removed.length === 0) return;
      pushAction({ type: "remove", before: removed, after: [] });
      setElements(prev.filter((el) => !ids.has(el.id)));
    },
    [pushAction, setElements],
  );

  const updateElements = useCallback(
    (updated: IWhiteboardElement[]) => {
      if (updated.length === 0) return;
      const prev = elementsRef.current;
      const updatedMap = new Map(updated.map((el) => [el.id, el]));
      const before = prev.filter((el) => updatedMap.has(el.id));
      pushAction({ type: "update", before, after: updated });
      setElements(prev.map((el) => updatedMap.get(el.id) ?? el));
    },
    [pushAction, setElements],
  );

  const replaceAll = useCallback(
    (els: IWhiteboardElement[]) => {
      setElements(els);
      undoStack.current = [];
      redoStack.current = [];
      setRevision((r) => r + 1);
    },
    [setElements],
  );

  const undo = useCallback(() => {
    const entry = undoStack.current.pop();
    if (!entry) return;

    setElements((prev) => {
      let next = prev;
      switch (entry.type) {
        case "add":
          {
            const ids = new Set(entry.after.map((el) => el.id));
            next = prev.filter((el) => !ids.has(el.id));
          }
          break;
        case "remove":
          {
            const existingIds = new Set(prev.map((el) => el.id));
            const toRestore = entry.before.filter(
              (el) => !existingIds.has(el.id),
            );
            next = [...prev, ...toRestore];
          }
          break;
        case "update":
          {
            const beforeMap = new Map(entry.before.map((el) => [el.id, el]));
            next = prev.map((el) => beforeMap.get(el.id) ?? el);
          }
          break;
        case "batch":
          {
            const beforeMap = new Map(entry.before.map((el) => [el.id, el]));
            const beforeIds = new Set(entry.before.map((el) => el.id));
            const afterIds = new Set(entry.after.map((el) => el.id));

            next = prev.filter(
              (el) => !(afterIds.has(el.id) && !beforeIds.has(el.id)),
            );

            const existingIds = new Set(next.map((el) => el.id));
            next = next.map((el) => beforeMap.get(el.id) ?? el);
            for (const el of entry.before) {
              if (!existingIds.has(el.id)) {
                next.push(el);
              }
            }
          }
          break;
      }
      return next;
    });

    if (entry.background) backgroundApplier.current?.(entry.background.before);

    redoStack.current.push(entry);
    setRevision((r) => r + 1);
  }, [setElements]);

  const redo = useCallback(() => {
    const entry = redoStack.current.pop();
    if (!entry) return;

    setElements((prev) => {
      let next = prev;
      switch (entry.type) {
        case "add":
          {
            const existingIds = new Set(prev.map((el) => el.id));
            const toAdd = entry.after.filter((el) => !existingIds.has(el.id));
            next = [...prev, ...toAdd];
          }
          break;
        case "remove":
          {
            const ids = new Set(entry.before.map((el) => el.id));
            next = prev.filter((el) => !ids.has(el.id));
          }
          break;
        case "update":
          {
            const afterMap = new Map(entry.after.map((el) => [el.id, el]));
            next = prev.map((el) => afterMap.get(el.id) ?? el);
          }
          break;
        case "batch":
          {
            const afterMap = new Map(entry.after.map((el) => [el.id, el]));
            const afterIds = new Set(entry.after.map((el) => el.id));
            const beforeIds = new Set(entry.before.map((el) => el.id));

            next = prev.filter(
              (el) => !(beforeIds.has(el.id) && !afterIds.has(el.id)),
            );

            const existingIds = new Set(next.map((el) => el.id));
            next = next.map((el) => afterMap.get(el.id) ?? el);
            for (const el of entry.after) {
              if (!existingIds.has(el.id)) {
                next.push(el);
              }
            }
          }
          break;
      }
      return next;
    });

    if (entry.background) backgroundApplier.current?.(entry.background.after);

    undoStack.current.push(entry);
    setRevision((r) => r + 1);
  }, [setElements]);

  return {
    elements,
    getElements,
    setElements,
    addElements,
    removeElements,
    updateElements,
    replaceAll,
    pushAction,
    setBackgroundApplier,
    undo,
    redo,
    canUndo,
    canRedo,
    revision,
  };
}
