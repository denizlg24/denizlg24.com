import { DashboardNative } from "@modules/dashboard-native";
import { createNativeAuth, type SessionStore } from "@repo/native-auth";
import { expoAuthPlatform } from "@repo/native-auth/expo";
import { REDIRECT_URI, SITE } from "./config";

let memory: string | null = null;

/**
 * The App Group keychain, so widgets, App Intents and the Share extension
 * sign in with the same session. Expo Go keeps it in memory.
 */
const store: SessionStore = {
  read: async () => (DashboardNative ? DashboardNative.getSession() : memory),
  write: async (json) => {
    if (DashboardNative) DashboardNative.setSession(json);
    else memory = json;
  },
};

export const auth = createNativeAuth({
  site: SITE,
  redirectUri: REDIRECT_URI,
  store,
  platform: expoAuthPlatform((input, init) => fetch(input, init)),
  onSignedOut: () => {
    void DashboardNative?.clear();
  },
});
