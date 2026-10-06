export function matches(
  item: { name: string; brand?: string | null },
  needle: string,
): boolean {
  return (
    item.name.toLocaleLowerCase().includes(needle) ||
    (item.brand?.toLocaleLowerCase().includes(needle) ?? false)
  );
}

export interface ServerSearch<T> {
  /** What the field holds now. */
  query: string;
  /** What was last sent; trails `query` while typing. */
  debounced: string;
  items: T[] | undefined;
  isPlaceholderData: boolean;
  isFetching: boolean;
  paused: boolean;
}

/**
 * While the field is ahead of the server, the previous answer stands in only
 * where it still matches the field, so a row the new text rules out never
 * shows. Paused offline or refused, it would read as this query's answer.
 */
export function serverResults<
  T extends { name: string; brand?: string | null },
>(
  search: ServerSearch<T>,
): { results: T[]; awaiting: boolean; settled: boolean } {
  const debouncing = search.debounced.trim() !== search.query.trim();
  const awaiting = debouncing || (!search.paused && search.isFetching);
  const current = !search.isPlaceholderData && !debouncing;
  const needle = search.query.trim().toLocaleLowerCase();
  const items = search.items ?? [];
  const results = current
    ? items
    : awaiting
      ? items.filter((item) => matches(item, needle))
      : [];
  return {
    results,
    awaiting,
    settled: current && search.items !== undefined,
  };
}
