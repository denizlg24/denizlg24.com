import { useSyncExternalStore } from "react";

export interface Store<T> {
  get: () => T;
  set: (next: T | ((current: T) => T)) => void;
  subscribe: (listener: () => void) => () => void;
}

function isUpdater<T>(
  next: T | ((current: T) => T),
): next is (current: T) => T {
  return typeof next === "function";
}

/**
 * State shared between a screen and the sheets it opens. Sheets are separate
 * routes, so anything they hand back has to live outside any one screen's
 * component tree.
 */
export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      const resolved = isUpdater(next) ? next(value) : next;
      if (Object.is(resolved, value)) return;
      value = resolved;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
