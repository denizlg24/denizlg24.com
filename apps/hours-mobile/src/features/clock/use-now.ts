import { useEffect, useState } from "react";
import { AppState } from "react-native";

/** The current time, ticking every second while `active`. */
export function useNow(active: boolean) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    setNow(new Date());
    if (!active) return;
    const timer = setInterval(() => setNow(new Date()), 1000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") setNow(new Date());
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [active]);
  return now;
}
