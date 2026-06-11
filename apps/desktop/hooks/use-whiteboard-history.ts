"use client";

import { useCallback, useRef, useState } from "react";
import type { IWhiteboardElement } from "@/lib/data-types";
import type { HistoryEntry } from "@/lib/whiteboard-types";

const MAX_HISTORY = 200;

export function useWhiteboardHistory(initialElements: IWhiteboardElement[]) {
  const [elements, setElements] =
    useState<IWhiteboardElement[]>(initialElements);
  const undoStack = useRef<HistoryEntry[]>([]);
  const redoStack = useRef<HistoryEntry[]>([]);

  const [revision, setRevision] = useState(0);

  const canUndo = undoStack.current.length > 0;
  const canRedo = redoStack.current.length > 0;

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
      setElements((prev) => {
        pushAction({ type: "add", before: [], after: newEls });
        return [...prev, ...newEls];
      });
    },
    [pushAction],
  );

  const removeElements = useCallback(
    (ids: Set<string>) => {
      setElements((prev) => {
        const removed = prev.filter((el) => ids.has(el.id));
        if (removed.length === 0) return prev;
        pushAction({ type: "remove", before: removed, after: [] });
        return prev.filter((el) => !ids.has(el.id));
      });
    },
    [pushAction],
  );

  const updateElements = useCallback(
    (updated: IWhiteboardElement[]) => {
      setElements((prev) => {
        const updatedMap = new Map(updated.map((el) => [el.id, el]));
        const before = prev.filter((el) => updatedMap.has(el.id));
        pushAction({ type: "update", before, after: updated });
        return prev.map((el) => updatedMap.get(el.id) ?? el);
      });
    },
    [pushAction],
  );

  const replaceAll = useCallback((els: IWhiteboardElement[]) => {
    setElements(els);
    undoStack.current = [];
    redoStack.current = [];
    setRevision((r) => r + 1);
  }, []);

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

    redoStack.current.push(entry);
    setRevision((r) => r + 1);
  }, []);

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

    undoStack.current.push(entry);
    setRevision((r) => r + 1);
  }, []);

  return {
    elements,
    setElements,
    addElements,
    removeElements,
    updateElements,
    replaceAll,
    pushAction,
    undo,
    redo,
    canUndo,
    canRedo,
    revision,
  };
}
