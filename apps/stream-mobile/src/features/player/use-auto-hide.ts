import { useCallback, useEffect, useRef, useState } from "react";

const HIDE_AFTER_MS = 4000;

/**
 * Chrome that fades away while something plays and nobody touches the
 * screen. It never hides while paused, nor while `hold` is set (a menu open,
 * a scrub in progress).
 */
export function useAutoHide(playing: boolean, hold: boolean) {
  const [visible, setVisible] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const poke = useCallback(() => {
    setVisible(true);
    clear();
    if (playing && !hold) {
      timer.current = setTimeout(() => setVisible(false), HIDE_AFTER_MS);
    }
  }, [playing, hold]);

  useEffect(() => {
    poke();
    return clear;
  }, [poke]);

  const toggle = useCallback(() => {
    if (visible && playing && !hold) {
      clear();
      setVisible(false);
    } else {
      poke();
    }
  }, [visible, playing, hold, poke]);

  return { visible, poke, toggle };
}
