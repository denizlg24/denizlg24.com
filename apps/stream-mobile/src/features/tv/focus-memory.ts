import { createContext, use, useState, useSyncExternalStore } from "react";

/**
 * Where focus was, and a way to send it back there. Every `Focusable` with a
 * `focusKey` notes itself on focus; `restore` makes that one item request
 * focus again, and only that item re-renders (its `preferred` turns true).
 * The rail uses it to return to the tile you left, and rows to come back to
 * the column you last rested on.
 */
export interface FocusMemory {
  last: () => string | null;
  note: (key: string) => void;
  /** Focus `key`, or the last noted item when none is given. */
  restore: (key?: string) => void;
  target: () => string | null;
  subscribe: (listener: () => void) => () => void;
}

export function createFocusMemory(): FocusMemory {
  let last: string | null = null;
  let target: string | null = null;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  return {
    last: () => last,
    note: (key) => {
      last = key;
      if (target === key) {
        target = null;
        emit();
      }
    },
    restore: (key) => {
      const next = key ?? last;
      if (!next) return;
      if (target === next) {
        // A request that never landed still holds `preferred` true, and the
        // native side only acts when it turns true: drop it for a frame.
        target = null;
        emit();
        setTimeout(() => {
          target = next;
          emit();
        }, 16);
        return;
      }
      target = next;
      emit();
    },
    target: () => target,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const FocusMemoryContext = createContext<FocusMemory | null>(null);

export function useFocusMemoryState(): FocusMemory {
  const [memory] = useState(createFocusMemory);
  return memory;
}

export function useFocusMemory(): FocusMemory | null {
  return use(FocusMemoryContext);
}

const never = () => () => undefined;

/** True while `key` is the item the memory wants focused. */
export function useIsRestoreTarget(
  memory: FocusMemory | null,
  key: string | undefined,
): boolean {
  return useSyncExternalStore(
    memory?.subscribe ?? never,
    () => key !== undefined && memory?.target() === key,
  );
}
