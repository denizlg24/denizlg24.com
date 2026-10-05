import { createStore, useStore } from "@/lib/store";

interface SelectionState {
  active: boolean;
  ids: ReadonlySet<string>;
}

const selection = createStore<SelectionState>({
  active: false,
  ids: new Set(),
});

export function useSelection(): SelectionState {
  return useStore(selection);
}

export function startSelecting() {
  selection.set({ active: true, ids: new Set() });
}

/** Enters selection with these entries already ticked (a long press, an hour). */
export function selectWith(ids: readonly string[]) {
  selection.set({ active: true, ids: new Set(ids) });
}

/** Ticks every id when any is unticked, otherwise unticks them all. */
export function toggleGroup(ids: readonly string[]) {
  selection.set((current) => {
    const next = new Set(current.ids);
    const all = ids.every((id) => next.has(id));
    for (const id of ids) {
      if (all) next.delete(id);
      else next.add(id);
    }
    return { ...current, ids: next };
  });
}

export function stopSelecting() {
  selection.set({ active: false, ids: new Set() });
}

export function toggleSelected(id: string) {
  selection.set((current) => {
    const ids = new Set(current.ids);
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    return { ...current, ids };
  });
}

export function setSelected(ids: readonly string[]) {
  selection.set((current) => ({ ...current, ids: new Set(ids) }));
}

/** Drops ids that are no longer on the day, e.g. after a refresh. */
export function keepSelected(visible: ReadonlySet<string>) {
  selection.set((current) => {
    const kept = [...current.ids].filter((id) => visible.has(id));
    return kept.length === current.ids.size
      ? current
      : { ...current, ids: new Set(kept) };
  });
}
