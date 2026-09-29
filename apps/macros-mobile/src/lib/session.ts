import type { QueryClient } from "@tanstack/react-query";
import * as SecureStore from "expo-secure-store";
import { unregisterFromRemotePush } from "@/features/notifications/push";
import { cancelReminders } from "@/features/notifications/reminders";
import { authClient } from "./auth-client";
import { clearFailedWrites } from "./failed-writes";
import { clearPersistedCaches } from "./query-client";

// Must match `storagePrefix` in auth-client.ts; these are the keys the Expo
// auth plugin writes.
const COOKIE_KEY = "macros_cookie";
const SESSION_CACHE_KEY = "macros_session_data";

/**
 * Forget the session on this device without asking the server. Used when the
 * server has already rejected the cookie — `signOut()` would fail with the
 * same 401 and the plugin only clears its storage on a successful sign-out.
 */
export async function forgetSessionLocally() {
  await Promise.all([
    SecureStore.deleteItemAsync(COOKIE_KEY),
    SecureStore.deleteItemAsync(SESSION_CACHE_KEY),
  ]);
  authClient.$store.notify("$sessionSignal");
}

/** Drops everything this device holds for the signed-in user. */
export async function clearSignedInDevice(queryClient: QueryClient) {
  await forgetSessionLocally();
  queryClient.clear();
  clearFailedWrites();
  await clearPersistedCaches();
}

export async function signOut(queryClient: QueryClient) {
  // Needs the session cookie, so it goes before the sign-out that clears it.
  await unregisterFromRemotePush();
  await cancelReminders().catch(() => undefined);
  await authClient.signOut().catch(() => undefined);
  await clearSignedInDevice(queryClient);
}
