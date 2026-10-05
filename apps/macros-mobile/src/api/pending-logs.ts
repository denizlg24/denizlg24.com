import AsyncStorage from "@react-native-async-storage/async-storage";
import type {
  MacrosCalendarTotals,
  MacrosDailyCalorieSummary,
  MacrosDailyMacros,
  MacrosDashboard,
  MacrosFoodLogDay,
} from "@repo/schemas/macros";
import { z } from "zod";
import { createStore, useStore } from "@/lib/store";

/**
 * Logs the phone knows about that the server's figures may not include yet.
 *
 * The totals the app shows are the cached server figures plus these, added
 * when they are read. Writing the optimistic sum into the cache instead lost
 * it to whatever refetch landed next while the write was still in flight — a
 * habit tick, the hub's icon refresh, a screen mounting — and the calories
 * flashed back to their old value until the write's own refetch came in.
 */
interface PendingLog {
  /** The write's `clientMutationId`. */
  id: string;
  logDate: string;
  macros: MacrosDailyMacros;
  /** When the server answered; null while the write is queued or in flight. */
  confirmedAt: number | null;
}

const ledger = createStore<readonly PendingLog[]>([]);

/** Confirmed entries only matter to data fetched before them; keep a few. */
const CONFIRMED_KEPT = 100;

// When the request behind each cached object started. A fetch that started
// after a write was confirmed includes it; anything older may not. Objects
// without a stamp (restored from disk) predate this session's writes.
const fetchStarts = new WeakMap<object, number>();

export function fetchStamped<T extends object>(
  fetch: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  return fetch().then((data) => {
    fetchStarts.set(data, startedAt);
    return data;
  });
}

/** For a cached object rebuilt from another: it carries the same server state. */
export function carryFetchStamp<T extends object>(
  from: object | undefined,
  to: T,
): T {
  const startedAt = from ? fetchStarts.get(from) : undefined;
  if (startedAt !== undefined) fetchStarts.set(to, startedAt);
  return to;
}

function missingFrom(data: object, entry: PendingLog) {
  return (
    entry.confirmedAt === null ||
    (fetchStarts.get(data) ?? 0) < entry.confirmedAt
  );
}

const ZERO: MacrosDailyMacros = { calories: 0, protein: 0, carbs: 0, fat: 0 };

function addMacros(
  a: MacrosDailyMacros,
  b: MacrosDailyMacros,
): MacrosDailyMacros {
  return {
    calories: a.calories + b.calories,
    protein: a.protein + b.protein,
    carbs: a.carbs + b.carbs,
    fat: a.fat + b.fat,
  };
}

function unseen(
  data: object,
  logDate: string,
  entries: readonly PendingLog[],
): MacrosDailyMacros | null {
  let sum: MacrosDailyMacros | null = null;
  for (const entry of entries) {
    if (entry.logDate !== logDate || !missingFrom(data, entry)) continue;
    sum = addMacros(sum ?? ZERO, entry.macros);
  }
  return sum;
}

export function withPendingSummary(
  summary: MacrosDailyCalorieSummary,
  entries: readonly PendingLog[] = ledger.get(),
): MacrosDailyCalorieSummary {
  const added = unseen(summary, summary.today, entries);
  return added
    ? { ...summary, consumed: summary.consumed + added.calories }
    : summary;
}

export function withPendingDashboard(
  dashboard: MacrosDashboard,
  entries: readonly PendingLog[] = ledger.get(),
): MacrosDashboard {
  const added = unseen(dashboard, dashboard.today, entries);
  return added
    ? { ...dashboard, consumed: addMacros(dashboard.consumed, added) }
    : dashboard;
}

export function withPendingDay(
  day: MacrosFoodLogDay,
  entries: readonly PendingLog[] = ledger.get(),
): MacrosFoodLogDay {
  const added = unseen(day, day.date, entries);
  return added ? { ...day, totals: addMacros(day.totals, added) } : day;
}

export function withPendingCalendar(
  totals: MacrosCalendarTotals,
  entries: readonly PendingLog[] = ledger.get(),
): MacrosCalendarTotals {
  if (entries.length === 0) return totals;
  let changed = false;
  const days = totals.days.map((day) => {
    const added = unseen(totals, day.date, entries);
    if (!added) return day;
    changed = true;
    return { ...day, calories: day.calories + added.calories };
  });
  return changed ? { ...totals, days } : totals;
}

export function usePendingLogs() {
  return useStore(ledger);
}

export function recordPendingLog(
  id: string,
  logDate: string,
  macros: MacrosDailyMacros,
) {
  ledger.set((entries) => [
    ...entries.filter((entry) => entry.id !== id),
    { id, logDate, macros, confirmedAt: null },
  ]);
}

export function confirmPendingLog(id: string | undefined) {
  if (!id) return;
  ledger.set((entries) => {
    if (!entries.some((entry) => entry.id === id)) return entries;
    const next = entries.map((entry) =>
      entry.id === id ? { ...entry, confirmedAt: Date.now() } : entry,
    );
    const confirmed = next.filter((entry) => entry.confirmedAt !== null);
    if (confirmed.length <= CONFIRMED_KEPT) return next;
    const dropped = new Set(
      confirmed.slice(0, confirmed.length - CONFIRMED_KEPT).map((e) => e.id),
    );
    return next.filter((entry) => !dropped.has(entry.id));
  });
}

export function dropPendingLog(id: string | undefined) {
  if (!id) return;
  ledger.set((entries) => entries.filter((entry) => entry.id !== id));
}

const storedSchema = z.array(
  z.object({
    id: z.string(),
    logDate: z.string(),
    macros: z.object({
      calories: z.number(),
      protein: z.number(),
      carbs: z.number(),
      fat: z.number(),
    }),
  }),
);

let storageKey: string | null = null;

// Only unconfirmed writes are kept across launches: they are the ones a
// paused mutation restored from disk will still send.
ledger.subscribe(() => {
  if (!storageKey) return;
  const waiting = ledger
    .get()
    .filter((entry) => entry.confirmedAt === null)
    .map(({ id, logDate, macros }) => ({ id, logDate, macros }));
  const write =
    waiting.length > 0
      ? AsyncStorage.setItem(storageKey, JSON.stringify(waiting))
      : AsyncStorage.removeItem(storageKey);
  write.catch(() => undefined);
});

/**
 * Called once the query cache is restored, with the ids of the writes it
 * restored. A stored entry without its write would count calories forever.
 */
export async function restorePendingLogs(
  userId: string,
  queuedIds: ReadonlySet<string>,
) {
  const key = `macros-pending-logs:${userId}`;
  if (storageKey !== null && storageKey !== key) {
    storageKey = null;
    ledger.set([]);
  }
  const raw = await AsyncStorage.getItem(key).catch(() => null);
  let stored: z.infer<typeof storedSchema> = [];
  try {
    const parsed = storedSchema.safeParse(raw ? JSON.parse(raw) : []);
    if (parsed.success) stored = parsed.data;
  } catch {
    stored = [];
  }
  storageKey = key;
  const live = ledger.get();
  ledger.set([
    ...stored
      .filter((entry) => queuedIds.has(entry.id))
      .filter((entry) => !live.some((existing) => existing.id === entry.id))
      .map((entry) => ({ ...entry, confirmedAt: null })),
    ...live,
  ]);
}
