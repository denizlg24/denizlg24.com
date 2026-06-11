"use client";

import { usePomodoroHydration } from "@/hooks/use-pomodoro-hydration";

export function BackgroundTasksInitializer() {
  usePomodoroHydration();
  return null;
}
