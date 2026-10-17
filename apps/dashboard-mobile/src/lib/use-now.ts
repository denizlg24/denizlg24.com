import { useEffect, useState } from "react";
import { AppState } from "react-native";

/** The current time, ticking every `intervalMs` while `active`, and on every return to the foreground. */
export function useNow(active: boolean, intervalMs = 1_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    setNow(new Date());
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") setNow(new Date());
    });
    const timer = active
      ? setInterval(() => setNow(new Date()), intervalMs)
      : null;
    return () => {
      if (timer) clearInterval(timer);
      subscription.remove();
    };
  }, [active, intervalMs]);
  return now;
}
