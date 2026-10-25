import { useCallback, useEffect, useRef, useState } from "react";
import { SEEK_SETTLE_MS, seekStep, seekTarget } from "./seek";

/**
 * Remote presses move a preview; the player seeks once the presses stop, so
 * holding an arrow is one seek rather than dozens queued against a stream.
 */
export function useSeekBuffer({
  position,
  duration,
  commit,
}: {
  position: number;
  duration: number;
  commit: (seconds: number) => void;
}) {
  const [target, setTarget] = useState<number | null>(null);
  const live = useRef({ position, duration, commit, target, repeats: 0 });
  live.current = { ...live.current, position, duration, commit, target };
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  /** `direction` is -1 or 1; `step` overrides the accelerating arrow step. */
  const nudge = useCallback((direction: -1 | 1, step?: number) => {
    const state = live.current;
    const delta = direction * (step ?? seekStep(state.repeats));
    state.repeats += 1;
    const next = seekTarget(
      state.target,
      state.position,
      delta,
      state.duration,
    );
    state.target = next;
    setTarget(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      live.current.repeats = 0;
      live.current.target = null;
      setTarget(null);
      live.current.commit(next);
    }, SEEK_SETTLE_MS);
  }, []);

  return { target, nudge };
}
