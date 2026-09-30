import type {
  MacrosDailyMacros,
  MacrosFoodLogDay,
  MacrosFoodLogEntry,
  MacrosUpdateLogEntryBody,
} from "@repo/schemas/macros";

// Kept free of React Native imports so it runs under `bun test`.

type EntryEdit = Partial<MacrosUpdateLogEntryBody>;

/** What the server will make of `entry` after `edit`, as far as the app can tell. */
export function applyEntryEdit(
  entry: MacrosFoodLogEntry,
  edit: EntryEdit,
): MacrosFoodLogEntry {
  const ratio =
    edit.servingsConsumed !== undefined && entry.servingsConsumed > 0
      ? edit.servingsConsumed / entry.servingsConsumed
      : 1;
  const nutrients = Object.fromEntries(
    Object.entries(entry.nutrients).map(([key, value]) => [key, value * ratio]),
  );
  return {
    ...entry,
    servingsConsumed: edit.servingsConsumed ?? entry.servingsConsumed,
    enteredQuantity: edit.enteredQuantity ?? entry.enteredQuantity,
    enteredUnit: edit.enteredUnit ?? entry.enteredUnit,
    notes: edit.notes === undefined ? entry.notes : edit.notes.trim() || null,
    eatenAt: edit.eatenAt ?? entry.eatenAt,
    logDate: edit.logDate ?? entry.logDate,
    nutrients,
    calories: entry.calories * ratio,
    protein: entry.protein * ratio,
    carbs: entry.carbs * ratio,
    fat: entry.fat * ratio,
  };
}

function shiftTotals(
  totals: MacrosDailyMacros,
  entry: MacrosFoodLogEntry,
  sign: 1 | -1,
): MacrosDailyMacros {
  return {
    calories: totals.calories + sign * entry.calories,
    protein: totals.protein + sign * entry.protein,
    carbs: totals.carbs + sign * entry.carbs,
    fat: totals.fat + sign * entry.fat,
  };
}

export function withoutEntry(
  day: MacrosFoodLogDay,
  entry: MacrosFoodLogEntry,
): MacrosFoodLogDay {
  return {
    ...day,
    entries: day.entries.filter((candidate) => candidate.id !== entry.id),
    totals: shiftTotals(day.totals, entry, -1),
  };
}

/** Adds or replaces `entry` in `day`, keeping the totals in step. */
export function withEntry(
  day: MacrosFoodLogDay,
  entry: MacrosFoodLogEntry,
): MacrosFoodLogDay {
  const previous = day.entries.find((candidate) => candidate.id === entry.id);
  const totals = shiftTotals(
    previous ? shiftTotals(day.totals, previous, -1) : day.totals,
    entry,
    1,
  );
  return {
    ...day,
    entries: previous
      ? day.entries.map((candidate) =>
          candidate.id === entry.id ? entry : candidate,
        )
      : [...day.entries, entry],
    totals,
  };
}
