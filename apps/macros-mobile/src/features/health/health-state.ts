import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";
import { createStore, useStore } from "@/lib/store";

const healthStateSchema = z.object({
  enabled: z.boolean(),
  /** The last day whose weigh-in and activity reached the server. */
  importedThrough: z.string().nullable(),
  lastSyncedAt: z.number().nullable(),
  lastError: z.string().nullable(),
  /**
   * Weigh-ins deleted here that Health still holds. The import re-reads
   * recent days, and would otherwise bring a deleted bad reading straight
   * back; the weight is part of the key so a new reading that day imports.
   */
  dismissedWeighIns: z
    .array(z.object({ logDate: z.string(), weightKg: z.number() }))
    .default([]),
});

export type HealthState = z.infer<typeof healthStateSchema>;

const initial: HealthState = {
  enabled: false,
  importedThrough: null,
  lastSyncedAt: null,
  lastError: null,
  dismissedWeighIns: [],
};

// Per user and per device: another phone on the same account has its own
// Health store and its own permission.
const healthState = createStore<HealthState>(initial);
let activeUser: string | null = null;

function storageKey(userId: string) {
  return `macros.health.${userId}`;
}

export async function loadHealthState(userId: string) {
  if (activeUser === userId) return;
  activeUser = userId;
  healthState.set(initial);
  const raw = await AsyncStorage.getItem(storageKey(userId)).catch(() => null);
  if (activeUser !== userId || !raw) return;
  try {
    const parsed = healthStateSchema.safeParse(JSON.parse(raw));
    if (parsed.success) healthState.set(parsed.data);
  } catch {
    // A corrupt entry reads as "never set up"; enabling again rewrites it.
  }
}

export function updateHealthState(patch: Partial<HealthState>) {
  healthState.set((current) => ({ ...current, ...patch }));
  const userId = activeUser;
  if (!userId) return;
  void AsyncStorage.setItem(
    storageKey(userId),
    JSON.stringify(healthState.get()),
  ).catch(() => undefined);
}

/** Keeps only what the import window can still re-read. */
export function dismissImportedWeighIn(
  weighIn: { logDate: string; weightKg: number },
  oldestReadable: string,
) {
  const kept = healthState
    .get()
    .dismissedWeighIns.filter((item) => item.logDate >= oldestReadable);
  updateHealthState({ dismissedWeighIns: [...kept, weighIn] });
}

/** For a deleted account: its Health setup must not outlive it. */
export async function forgetHealthState() {
  const userId = activeUser;
  healthState.set(initial);
  if (userId) {
    await AsyncStorage.removeItem(storageKey(userId)).catch(() => undefined);
  }
}

export function getHealthState() {
  return healthState.get();
}

export function useHealthState() {
  return useStore(healthState);
}
