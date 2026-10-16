import { DashboardNative } from "@modules/dashboard-native";
import {
  type DashboardLocalNotificationSettings,
  type DashboardNotificationPrefs,
  dashboardLocalNotificationSettingsSchema,
  dashboardNotificationPrefsSchema,
} from "@repo/schemas";
import { useSyncExternalStore } from "react";
import { z } from "zod";

const settingsSchema = z.object({
  notifications: dashboardNotificationPrefsSchema.default({}),
  local: dashboardLocalNotificationSettingsSchema.default({
    eventLeadMinutes: 10,
    classLeadMinutes: 10,
  }),
});
export type Settings = z.infer<typeof settingsSchema>;

function read(): Settings {
  const raw = DashboardNative?.getSettings() ?? null;
  try {
    return settingsSchema.parse(raw ? JSON.parse(raw) : {});
  } catch {
    return settingsSchema.parse({});
  }
}

let current: Settings = read();
const listeners = new Set<() => void>();

export function getSettings() {
  return current;
}

function write(next: Settings) {
  current = next;
  DashboardNative?.setSettings(JSON.stringify(next));
  for (const listener of listeners) listener();
}

export function setNotificationPrefs(prefs: DashboardNotificationPrefs) {
  write({ ...current, notifications: prefs });
}

export function setLocalSettings(local: DashboardLocalNotificationSettings) {
  write({ ...current, local });
}

export function useSettings() {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, getSettings);
}
