import { useSyncExternalStore } from "react";

/**
 * Writes the server refused after the screen that made them had moved on —
 * usually queued offline and replayed later. They surface on every screen that
 * shows the log instead of vanishing.
 */
export interface FailedWrite {
  id: string;
  description: string;
  message: string;
  retry?: () => void;
}

interface RecordOptions {
  /**
   * The write's idempotency key where it has one. A live failure is reported
   * twice — by the mutation's registered default and by the screen that made
   * it — and keying on the write keeps that to one notice.
   */
  id?: string;
  retry?: () => void;
}

let failures: readonly FailedWrite[] = [];
const listeners = new Set<() => void>();
let counter = 0;

function emit() {
  for (const listener of listeners) listener();
}

export function recordFailedWrite(
  description: string,
  message: string,
  { id, retry }: RecordOptions = {},
) {
  const key = id ?? `failure-${++counter}`;
  const existing = failures.find((failure) => failure.id === key);
  const next: FailedWrite = {
    id: key,
    description,
    message,
    retry: retry ?? existing?.retry,
  };
  failures = existing
    ? failures.map((failure) => (failure.id === key ? next : failure))
    : [...failures, next];
  emit();
}

export function dismissFailedWrite(id: string) {
  failures = failures.filter((failure) => failure.id !== id);
  emit();
}

export function clearFailedWrites() {
  failures = [];
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useFailedWrites(): readonly FailedWrite[] {
  return useSyncExternalStore(subscribe, () => failures);
}
