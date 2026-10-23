import type { AuthStorage } from "@denizlg24/auth/client";
import * as SecureStore from "expo-secure-store";

/** SecureStore keys allow only `[A-Za-z0-9._-]`; the SDK's carry a colon. */
export function secureKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, "_");
}

const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

export const secureStorage: AuthStorage = {
  get: (key) => SecureStore.getItemAsync(secureKey(key), options),
  set: (key, value) => SecureStore.setItemAsync(secureKey(key), value, options),
  remove: (key) => SecureStore.deleteItemAsync(secureKey(key), options),
};
