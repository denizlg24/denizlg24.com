import { useEffect } from "react";
import { usePomodoroStore } from "@/stores/pomodoro";

export function usePomodoroHydration() {
  const hydrate = usePomodoroStore((s) => s.hydrate);
  useEffect(() => {
    hydrate();
  }, [hydrate]);
}
