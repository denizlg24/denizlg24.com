import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect } from "react";
import { useProfile } from "@/api/profile";
import { createStore, useStore } from "@/features/add-food/store";
import {
  DEFAULT_REMINDER_SETTINGS,
  type ReminderSettings,
  readReminderSettings,
} from "./reminder-plan";

type State = { settings: ReminderSettings; loaded: boolean };

const state = createStore<State>({
  settings: DEFAULT_REMINDER_SETTINGS,
  loaded: false,
});
let activeKey: string | null = null;

/**
 * One set of reminders per account on this phone, so someone else signing in
 * does not inherit the previous person's schedule.
 */
async function activate(userId: string) {
  const key = `macros-reminders:${userId}`;
  if (activeKey === key) return;
  activeKey = key;
  state.set({ settings: DEFAULT_REMINDER_SETTINGS, loaded: false });
  const raw = await AsyncStorage.getItem(key).catch(() => null);
  if (activeKey !== key) return;
  state.set({ settings: readReminderSettings(raw), loaded: true });
}

export function useReminderSettings(): State {
  const userId = useProfile().data?.userId;
  useEffect(() => {
    if (userId) void activate(userId);
  }, [userId]);
  return useStore(state);
}

export function updateReminderSettings(
  update: (current: ReminderSettings) => ReminderSettings,
) {
  const current = state.get();
  if (!current.loaded || !activeKey) return;
  const settings = update(current.settings);
  state.set({ settings, loaded: true });
  AsyncStorage.setItem(activeKey, JSON.stringify(settings)).catch(
    () => undefined,
  );
}
