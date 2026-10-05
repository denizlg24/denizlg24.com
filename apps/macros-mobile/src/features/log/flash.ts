import type { MacrosFoodLogEntry } from "@repo/schemas/macros";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { createStore } from "@/lib/store";

const tokens = createStore<ReadonlyMap<string, number>>(new Map());
let counter = 0;

/**
 * Replays the flash on the given rows. Sheets pass a delay so the tint is
 * still running once the sheet has slid out of the way.
 */
export function flashEntries(ids: readonly string[], delayMs = 0) {
  const run = () => {
    tokens.set((current) => {
      const next = new Map(current);
      for (const id of ids) next.set(id, ++counter);
      return next;
    });
  };
  if (delayMs > 0) setTimeout(run, delayMs);
  else run();
}

export function useEntryFlashToken(id: string): number | undefined {
  return useSyncExternalStore(
    tokens.subscribe,
    () => tokens.get().get(id),
    () => tokens.get().get(id),
  );
}

/**
 * Entries that arrive between two renders of the same day were logged
 * somewhere else — the Add tab, a copy, another device — so they flash.
 */
export function useFlashArrivals(
  date: string,
  entries: readonly MacrosFoodLogEntry[] | undefined,
) {
  const key = useMemo(
    () => entries?.map((entry) => entry.id).join(",") ?? null,
    [entries],
  );
  const seen = useRef<{ date: string; ids: Set<string> } | null>(null);

  useEffect(() => {
    if (key === null) return;
    const ids = key === "" ? [] : key.split(",");
    const previous = seen.current;
    seen.current = { date, ids: new Set(ids) };
    if (!previous || previous.date !== date) return;
    const arrived = ids.filter((id) => !previous.ids.has(id));
    if (arrived.length > 0) flashEntries(arrived);
  }, [date, key]);
}
