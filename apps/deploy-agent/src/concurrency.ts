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

export class SerialQueueDrainingError extends Error {
  constructor() {
    super("The queue is draining and accepts no new work");
    this.name = "SerialQueueDrainingError";
  }
}

export interface SerialQueue {
  <T>(task: () => Promise<T>): Promise<T>;
  /**
   * Refuses new tasks and waits for every accepted one to settle. Resolves
   * with the release that reopens the queue, or null — already reopened — when
   * they did not settle within `timeoutMs` or a drain is already in progress.
   */
  drain(timeoutMs: number): Promise<(() => void) | null>;
}

/**
 * Runs the tasks handed to it one at a time, in arrival order. A rejection is
 * the caller's; the next task still runs.
 */
export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();
  let draining = false;
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    if (draining) return Promise.reject(new SerialQueueDrainingError());
    const run = tail.then(task);
    tail = run.catch(() => undefined);
    return run;
  };
  const drain = async (timeoutMs: number) => {
    if (draining) return null;
    draining = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settled = await Promise.race([
      tail.then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
    clearTimeout(timer);
    if (!settled) {
      draining = false;
      return null;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      draining = false;
    };
  };
  return Object.assign(enqueue, { drain });
}
