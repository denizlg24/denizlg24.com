import { useEffect, useState } from "react";

function remainingSeconds(since: number | null, seconds: number): number {
  if (since === null) return 0;
  return Math.max(0, Math.ceil((since + seconds * 1000 - Date.now()) / 1000));
}

/** Seconds left before an email can be sent again, ticking down to 0. */
export function useCooldown(since: number | null, seconds: number): number {
  const [remaining, setRemaining] = useState(() =>
    remainingSeconds(since, seconds),
  );

  useEffect(() => {
    setRemaining(remainingSeconds(since, seconds));
    if (since === null) return;
    const timer = setInterval(() => {
      const next = remainingSeconds(since, seconds);
      setRemaining(next);
      if (next === 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [since, seconds]);

  return remaining;
}
