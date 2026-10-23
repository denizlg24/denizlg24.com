import { useCallback, useEffect, useRef, useState } from "react";

export const CHROME_IDLE_MS = 3000;

/** Visible while `hold` is true; otherwise hides `delayMs` after the last `reveal`. */
export function useAutoHide(hold: boolean, delayMs = CHROME_IDLE_MS) {
  const [visible, setVisible] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdRef = useRef(hold);
  holdRef.current = hold;

  const clear = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const schedule = useCallback(() => {
    clear();
    timer.current = setTimeout(() => {
      if (!holdRef.current) setVisible(false);
    }, delayMs);
  }, [clear, delayMs]);

  const reveal = useCallback(() => {
    setVisible(true);
    schedule();
  }, [schedule]);

  const hide = useCallback(() => {
    clear();
    if (!holdRef.current) setVisible(false);
  }, [clear]);

  useEffect(() => {
    if (hold) {
      clear();
      setVisible(true);
    } else {
      schedule();
    }
  }, [hold, clear, schedule]);

  useEffect(() => clear, [clear]);

  return { visible, reveal, hide };
}
