import { HoursNative } from "@modules/hours-native";
import { useSyncExternalStore } from "react";
import { DEFAULT_SETTINGS, type ReminderSettings } from "./plan";

function read(): ReminderSettings {
  try {
    const raw = HoursNative?.getSettings();
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

let current = read();
const listeners = new Set<() => void>();

export function getReminderSettings() {
  return current;
}

export function setReminderSettings(patch: Partial<ReminderSettings>) {
  current = { ...current, ...patch };
  HoursNative?.setSettings(JSON.stringify(current));
  for (const listener of listeners) listener();
}

export function useReminderSettings() {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, getReminderSettings);
}
