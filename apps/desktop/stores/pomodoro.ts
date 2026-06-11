import { create } from "zustand";
import { useBackgroundTasksStore } from "./background-tasks";

export type TimerMode = "focus" | "break";

export type Session = {
  startedAt: string;
  duration: number;
  completedAt: string;
};

export const DURATIONS: Record<TimerMode, number> = {
  focus: 25 * 60,
  break: 5 * 60,
};

export const POMODORO_TARGET = 4;

const STORE_FILENAME = "pomodoro.json";
const FOCUS_COMPLETE_SOUND = "/assets/Bling.m4a";
const BREAK_COMPLETE_SOUND = "/assets/Bling.m4a";

let intervalId: ReturnType<typeof setInterval> | null = null;

async function getPomodoroStore() {
  const { load } = await import("@tauri-apps/plugin-store");
  return load(STORE_FILENAME, { defaults: { sessions: [] }, autoSave: true });
}

async function loadSessions(): Promise<Session[]> {
  if (typeof window === "undefined") return [];
  try {
    const store = await getPomodoroStore();
    return (await store.get<Session[]>("sessions")) ?? [];
  } catch {
    return [];
  }
}

async function saveSessions(sessions: Session[]): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const store = await getPomodoroStore();
    await store.set("sessions", sessions);
  } catch (e) {
    console.error("Failed to save pomodoro sessions:", e);
  }
}

function playSound(src: string) {
  try {
    const audio = new Audio(src);
    audio.volume = 0.5;
    audio.play();
  } catch {}
}

async function sendDesktopNotification(title: string, body: string) {
  try {
    const { sendNotification, isPermissionGranted, requestPermission } =
      await import("@tauri-apps/plugin-notification");

    let granted = await isPermissionGranted();
    if (!granted) {
      const result = await requestPermission();
      granted = result === "granted";
    }
    if (granted) {
      sendNotification({ title, body });
    }
  } catch {}
}

function formatTime(totalSeconds: number) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function syncBackgroundTask(mode: TimerMode, seconds: number, active: boolean) {
  const bg = useBackgroundTasksStore.getState();
  if (active || bg.tasks.pomodoro) {
    const task = {
      id: "pomodoro",
      label: mode === "focus" ? "Focus" : "Break",
      statusText: formatTime(seconds),
      color: mode === "focus" ? "bg-red-500" : "bg-accent",
      href: "/dashboard/pomodoro",
      active,
    };
    if (bg.tasks.pomodoro) {
      bg.update("pomodoro", task);
    } else {
      bg.register(task);
    }
  }
}

type PomodoroState = {
  mode: TimerMode;
  seconds: number;
  running: boolean;
  sessionStartedAt: string | null;
  sessionCount: number;
  allSessions: Session[];
  hydrated: boolean;

  hydrate: () => void;
  start: () => void;
  pause: () => void;
  reset: () => void;
  switchMode: (mode: TimerMode) => void;
  toggleStartPause: () => void;
  clearAllSessions: () => void;
};

export const usePomodoroStore = create<PomodoroState>((set, get) => {
  function tick() {
    const state = get();
    const next = state.seconds - 1;

    if (next <= 0) {
      clearTickInterval();
      handleComplete();
      return;
    }

    set({ seconds: next });
    syncBackgroundTask(state.mode, next, true);
  }

  function startTickInterval() {
    clearTickInterval();
    intervalId = setInterval(tick, 1000);
  }

  function clearTickInterval() {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  async function handleComplete() {
    const state = get();

    if (state.mode === "focus") {
      const now = new Date().toISOString();
      const session: Session = {
        startedAt: state.sessionStartedAt ?? now,
        duration: DURATIONS.focus,
        completedAt: now,
      };
      const updatedSessions = [...state.allSessions, session];

      set({
        mode: "break",
        seconds: DURATIONS.break,
        running: true,
        sessionStartedAt: now,
        sessionCount: state.sessionCount + 1,
        allSessions: updatedSessions,
      });

      await saveSessions(updatedSessions);
      playSound(FOCUS_COMPLETE_SOUND);
      sendDesktopNotification("Focus session complete!", "Time for a break.");
      syncBackgroundTask("break", DURATIONS.break, true);
      startTickInterval();
    } else {
      set({
        mode: "focus",
        seconds: DURATIONS.focus,
        running: false,
        sessionStartedAt: null,
      });

      playSound(BREAK_COMPLETE_SOUND);
      sendDesktopNotification("Break's over!", "Ready to focus?");
      useBackgroundTasksStore.getState().unregister("pomodoro");
    }
  }

  return {
    mode: "focus",
    seconds: DURATIONS.focus,
    running: false,
    sessionStartedAt: null,
    sessionCount: 0,
    allSessions: [],
    hydrated: false,

    hydrate: () => {
      if (get().hydrated) return;
      set({ hydrated: true });
      loadSessions().then((sessions) => {
        const today = new Date();
        const todayCount = sessions.filter((s) => {
          const d = new Date(s.completedAt);
          return (
            d.getFullYear() === today.getFullYear() &&
            d.getMonth() === today.getMonth() &&
            d.getDate() === today.getDate()
          );
        }).length;
        set({ allSessions: sessions, sessionCount: todayCount });
      });
    },

    start: () => {
      const state = get();
      if (state.running) return;
      const sessionStartedAt =
        state.sessionStartedAt ?? new Date().toISOString();
      set({ running: true, sessionStartedAt });
      syncBackgroundTask(state.mode, state.seconds, true);
      startTickInterval();
    },

    pause: () => {
      clearTickInterval();
      const state = get();
      set({ running: false });
      syncBackgroundTask(state.mode, state.seconds, false);
    },

    reset: () => {
      clearTickInterval();
      const state = get();
      set({
        running: false,
        seconds: DURATIONS[state.mode],
        sessionStartedAt: null,
      });
      useBackgroundTasksStore.getState().unregister("pomodoro");
    },

    switchMode: (newMode: TimerMode) => {
      clearTickInterval();
      set({
        mode: newMode,
        running: false,
        seconds: DURATIONS[newMode],
        sessionStartedAt: null,
      });
      useBackgroundTasksStore.getState().unregister("pomodoro");
    },

    toggleStartPause: () => {
      const state = get();
      if (state.running) {
        state.pause();
      } else {
        state.start();
      }
    },

    clearAllSessions: async () => {
      set({ allSessions: [], sessionCount: 0 });
      if (typeof window === "undefined") return;
      try {
        const store = await getPomodoroStore();
        await store.set("sessions", []);
      } catch (e) {
        console.error("Failed to clear pomodoro sessions:", e);
      }
    },
  };
});
