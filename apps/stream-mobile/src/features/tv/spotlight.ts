import { useState, useSyncExternalStore } from "react";

/** Long enough that holding an arrow down doesn't swap the backdrop per poster. */
const SETTLE_MS = 160;

export interface Spotlight<T> {
  get: () => T | null;
  /** Stable: safe to hand to every poster without re-rendering the rows. */
  set: (value: T) => void;
  subscribe: (listener: () => void) => () => void;
}

function createSpotlight<T>(): Spotlight<T> {
  let value: T | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (next === value) return;
        value = next;
        for (const listener of listeners) listener();
      }, SETTLE_MS);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * What the remote is resting on, kept outside React state: the screen that
 * owns the rows never re-renders when focus moves, only the backdrop and the
 * spotlight that read it with `useSpot`.
 */
export function useSpotlight<T>(): Spotlight<T> {
  const [spotlight] = useState(createSpotlight<T>);
  return spotlight;
}

export function useSpot<T>(spotlight: Spotlight<T>): T | null {
  return useSyncExternalStore(spotlight.subscribe, spotlight.get);
}
