/**
 * `Promise.all` over a mapped array with a ceiling on how many run at once.
 *
 * Every fan-out in this process is over something the host decides the size of
 * — containers on the daemon, live deployments, entries in `/proc` — so an
 * unbounded `Promise.all` opens as many descriptors and allocates as many read
 * buffers as the box happens to have work. Results keep the input's order.
 */
export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  map: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (next < values.length) {
        const index = next++;
        const value = values[index];
        if (value !== undefined) results[index] = await map(value);
      }
    }),
  );
  return results;
}

/**
 * Runs the tasks handed to it one at a time, in arrival order. A rejection is
 * the caller's; the next task still runs.
 */
export function createSerialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return (task) => {
    const run = tail.then(task);
    tail = run.catch(() => undefined);
    return run;
  };
}
