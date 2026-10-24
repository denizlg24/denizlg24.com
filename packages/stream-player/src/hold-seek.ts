import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { clamp } from "./time";

export const HOLD_DELAY_MS = 450;
export const HOLD_TICK_MS = 250;
/** TV remotes may never send a key-up; a gap in repeats counts as release. */
export const KEY_RELEASE_MS = 700;

/** Seconds one tick moves after `heldMs`: the step, then doubling twice. */
export function holdStep(heldMs: number, step: number): number {
  if (heldMs < 1500) return step;
  if (heldMs < 4000) return step * 2;
  return step * 4;
}

type Direction = -1 | 1;

interface Hold {
  direction: Direction;
  target: number;
  startedAt: number;
  lastKeyAt: number | null;
  delay: ReturnType<typeof setTimeout> | null;
  tick: ReturnType<typeof setInterval> | null;
  watchdog: ReturnType<typeof setInterval> | null;
}

/**
 * Press for one step; hold to keep moving, faster the longer it is held. The
 * target is only previewed while held and sought once on release, so the
 * player does not reload its buffer on every tick.
 */
export function useHoldSeek({
  step,
  position,
  duration,
  commit,
}: {
  step: number;
  position: number;
  duration: number;
  commit: (seconds: number) => void;
}) {
  const [target, setTarget] = useState<number | null>(null);
  const hold = useRef<Hold | null>(null);
  const latest = useRef({ position, duration, commit, step });
  latest.current = { position, duration, commit, step };

  const clear = useCallback((current: Hold) => {
    if (current.delay) clearTimeout(current.delay);
    if (current.tick) clearInterval(current.tick);
    if (current.watchdog) clearInterval(current.watchdog);
  }, []);

  const stop = useCallback(() => {
    const current = hold.current;
    if (!current) return;
    clear(current);
    hold.current = null;
    setTarget(null);
    latest.current.commit(current.target);
  }, [clear]);

  const start = useCallback(
    (direction: Direction, byKey: boolean) => {
      const current = hold.current;
      if (current?.direction === direction) {
        if (byKey) current.lastKeyAt = Date.now();
        return;
      }
      if (current) stop();
      const { position: from, duration: length } = latest.current;
      const next: Hold = {
        direction,
        target: clamp(from + direction * latest.current.step, 0, length),
        startedAt: Date.now(),
        lastKeyAt: byKey ? Date.now() : null,
        delay: null,
        tick: null,
        watchdog: null,
      };
      hold.current = next;
      setTarget(next.target);
      next.delay = setTimeout(() => {
        next.tick = setInterval(() => {
          next.target = clamp(
            next.target +
              direction *
                holdStep(Date.now() - next.startedAt, latest.current.step),
            0,
            latest.current.duration,
          );
          setTarget(next.target);
        }, HOLD_TICK_MS);
      }, HOLD_DELAY_MS);
      if (byKey) {
        next.watchdog = setInterval(() => {
          if (next.lastKeyAt && Date.now() - next.lastKeyAt > KEY_RELEASE_MS)
            stop();
        }, HOLD_TICK_MS);
      }
    },
    [stop],
  );

  useEffect(
    () => () => {
      if (hold.current) clear(hold.current);
    },
    [clear],
  );

  /** Props for a button that seeks `direction` steps while pressed. */
  const bind = (direction: Direction) => ({
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      start(direction, false);
    },
    onPointerUp: stop,
    onPointerCancel: stop,
    onLostPointerCapture: stop,
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      start(direction, true);
    },
    onKeyUp: (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      stop();
    },
    onBlur: stop,
    // Assistive tech activates with a bare click (detail 0) and no press.
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      if (event.detail !== 0 || hold.current) return;
      const { position: from, duration: length } = latest.current;
      latest.current.commit(
        clamp(from + direction * latest.current.step, 0, length),
      );
    },
  });

  return { target, holding: target !== null, bind, start, stop };
}
