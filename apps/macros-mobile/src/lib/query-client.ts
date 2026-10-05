import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import {
  focusManager,
  notifyManager,
  onlineManager,
  QueryClient,
} from "@tanstack/react-query";
import { addNetworkStateListener, getNetworkStateAsync } from "expo-network";
import { AppState, type AppStateStatus } from "react-native";
import { registerHydrationMutationDefaults } from "@/api/body";
import { registerLogMutationDefaults } from "@/api/food-log";
import { registerHabitMutationDefaults } from "@/api/habits";
import { registerMealTemplateMutationDefaults } from "@/api/meal-templates";
import { restorePendingLogs } from "@/api/pending-logs";
import { registerShoppingListMutationDefaults } from "@/api/shopping-list";
import { registerWeightMutationDefaults } from "@/api/weight";
import { ApiError, isRetryable } from "./api";
import { APP_VERSION } from "./config";

const DAY_MS = 24 * 60 * 60 * 1000;

// React Query hands every result to components through `setTimeout(cb, 0)`.
// Timers stall in the add-food hub until the next native event, which left a
// food sheet spinning on data that had already arrived and the last
// keystrokes of a search unsent. A microtask runs without the timer queue.
notifyManager.setScheduler(queueMicrotask);

export function createQueryClient() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // Must outlive the persister's maxAge, or restored data is collected
        // before anything reads it.
        gcTime: 7 * DAY_MS,
        retry: (failureCount, error) => failureCount < 2 && isRetryable(error),
        networkMode: "offlineFirst",
      },
      mutations: {
        networkMode: "offlineFirst",
        retry: (failureCount, error) =>
          failureCount < 3 &&
          !(error instanceof ApiError && error.status < 500),
      },
    },
  });
  // Totals are read with the logs still pending added on (`pending-logs.ts`),
  // keyed by the object each fetch returned. Structural sharing hands back
  // the previous object when a refetch matches it, and its older stamp.
  for (const queryKey of [["dashboard"], ["calorie-summary"], ["food-log"]]) {
    queryClient.setQueryDefaults(queryKey, { structuralSharing: false });
  }
  // Paused writes are persisted with their variables only; these defaults are
  // how a write queued offline finds its function again after a relaunch.
  registerLogMutationDefaults(queryClient);
  registerWeightMutationDefaults(queryClient);
  registerHabitMutationDefaults(queryClient);
  registerMealTemplateMutationDefaults(queryClient);
  registerShoppingListMutationDefaults(queryClient);
  registerHydrationMutationDefaults(queryClient);
  return queryClient;
}

/**
 * One persisted cache per account. Macros is multi-user and a phone can be
 * handed over, so a cache keyed by nothing would show the previous user's log
 * until the first refetch landed.
 */
export function createPersister(userId: string) {
  return createAsyncStoragePersister({
    storage: AsyncStorage,
    key: `macros-query-cache:${userId}`,
    throttleTime: 1000,
  });
}

/** After the cache is restored: the writes it brought back keep their totals. */
export function restorePendingLogsFor(
  queryClient: QueryClient,
  userId: string,
) {
  const queued = new Set<string>();
  for (const mutation of queryClient.getMutationCache().getAll()) {
    const variables: unknown = mutation.state.variables;
    if (
      typeof variables === "object" &&
      variables !== null &&
      "clientMutationId" in variables &&
      typeof variables.clientMutationId === "string"
    ) {
      queued.add(variables.clientMutationId);
    }
  }
  return restorePendingLogs(userId, queued);
}

export const PERSIST_MAX_AGE = 7 * DAY_MS;

/**
 * Raise to drop every persisted cache on the next launch without a version
 * change, when the server's data changed under it (the nutrition catalogue
 * rebuild of 2026-10-04 reassigned most food icons).
 */
const CACHE_EPOCH = 1;
export const PERSIST_BUSTER = `${APP_VERSION}:${CACHE_EPOCH}`;

export async function clearPersistedCaches() {
  const keys = await AsyncStorage.getAllKeys();
  const cacheKeys = keys.filter((key) => key.startsWith("macros-query-cache:"));
  if (cacheKeys.length > 0) await AsyncStorage.multiRemove(cacheKeys);
}

let wired = false;

/** React Query's online/focus managers default to browser events. */
export function wireReactQueryToNative() {
  if (wired) return;
  wired = true;

  onlineManager.setEventListener((setOnline) => {
    getNetworkStateAsync()
      .then((state) => setOnline(state.isInternetReachable !== false))
      .catch(() => undefined);
    const subscription = addNetworkStateListener((state) => {
      setOnline(state.isInternetReachable !== false);
    });
    return () => subscription.remove();
  });

  focusManager.setEventListener((handleFocus) => {
    const subscription = AppState.addEventListener(
      "change",
      (status: AppStateStatus) => handleFocus(status === "active"),
    );
    return () => subscription.remove();
  });
}
