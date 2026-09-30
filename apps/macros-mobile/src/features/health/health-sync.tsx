import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { AppState } from "react-native";
import { useProfile } from "@/api/profile";
import { authClient } from "@/lib/auth-client";
import { onFoodLogChanged } from "@/lib/log-events";
import {
  getHealthState,
  loadHealthState,
  useHealthState,
} from "./health-state";
import { healthAvailable, syncHealth, syncNutrition } from "./sync";

/** Reads happen on foreground; a closed app does not wake for Health. */
const FOREGROUND_INTERVAL_MS = 10 * 60 * 1000;
/** Several quick logs in a row write the day once. */
const LOG_DEBOUNCE_MS = 3000;

export function HealthSync() {
  const queryClient = useQueryClient();
  const userId = authClient.useSession().data?.user.id ?? null;
  const timeZone = useProfile().data?.timezone;
  const { enabled } = useHealthState();

  useEffect(() => {
    if (userId) void loadHealthState(userId);
  }, [userId]);

  useEffect(() => {
    if (!enabled || !timeZone || !healthAvailable()) return;
    const zone = timeZone;
    function syncIfStale() {
      const { lastSyncedAt } = getHealthState();
      if (lastSyncedAt && Date.now() - lastSyncedAt < FOREGROUND_INTERVAL_MS) {
        return;
      }
      void syncHealth(queryClient, zone);
    }
    syncIfStale();
    const subscription = AppState.addEventListener("change", (status) => {
      if (status === "active") syncIfStale();
    });
    return () => subscription.remove();
  }, [enabled, timeZone, queryClient]);

  useEffect(() => {
    if (!enabled || !timeZone || !healthAvailable()) return;
    const zone = timeZone;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let changed = new Set<string>();
    const unsubscribe = onFoodLogChanged((dates) => {
      for (const date of dates) changed.add(date);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const dates = [...changed];
        changed = new Set();
        void syncNutrition(zone, dates);
      }, LOG_DEBOUNCE_MS);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [enabled, timeZone]);

  return null;
}
