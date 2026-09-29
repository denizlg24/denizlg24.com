type Listener = () => void;

const listeners = new Set<Listener>();

/**
 * Fired whenever what was eaten may have changed, after the queries are
 * invalidated. Health sync rewrites the day's totals and the log reminder
 * skips today; neither belongs inside the invalidation helper itself.
 */
export function onFoodLogChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitFoodLogChanged() {
  for (const listener of listeners) listener();
}
