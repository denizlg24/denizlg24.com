import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useDeleteEntry } from "@/api/food-log";
import { haptics } from "@/lib/haptics";
import { flashEntries } from "./flash";

const UNDO_WINDOW_MS = 4_800;

/**
 * Deleting a row turns it into its own undo affordance for a few seconds
 * before the request goes out. Anything that takes the screen away — leaving
 * the day, the tab, or the app — commits what is pending rather than
 * dropping it, so a delete is never silently lost.
 */
export function useDeferredDelete(date: string) {
  const { mutate } = useDeleteEntry(date);
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const forget = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setPending((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }, []);

  const commit = useCallback(
    (id: string) => {
      forget(id);
      mutate(id);
    },
    [forget, mutate],
  );

  const schedule = useCallback(
    (id: string) => {
      if (timers.current.has(id)) return;
      haptics.warning();
      setPending((current) => new Set(current).add(id));
      timers.current.set(
        id,
        setTimeout(() => commit(id), UNDO_WINDOW_MS),
      );
    },
    [commit],
  );

  const undo = useCallback(
    (id: string) => {
      forget(id);
      haptics.selection();
      flashEntries([id]);
    },
    [forget],
  );

  const flush = useCallback(() => {
    for (const id of [...timers.current.keys()]) commit(id);
  }, [commit]);

  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (status) => {
      if (status !== "active") flushRef.current();
    });
    return () => {
      subscription.remove();
      flushRef.current();
    };
  }, []);

  return { pending, schedule, undo, flush };
}
