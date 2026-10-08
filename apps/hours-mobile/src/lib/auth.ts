import { HoursNative } from "@modules/hours-native";
import { createNativeAuth, type SessionStore } from "@repo/native-auth";
import { expoAuthPlatform } from "@repo/native-auth/expo";
import { REDIRECT_URI, SITE } from "./config";

let memory: string | null = null;

/**
 * The App Group keychain, so widgets and App Intents sign in with the same
 * session. Expo Go has no native module and keeps it in memory.
 */
const store: SessionStore = {
  read: async () => (HoursNative ? HoursNative.getSession() : memory),
  write: async (json) => {
    if (HoursNative) HoursNative.setSession(json);
    else memory = json;
  },
};

export const auth = createNativeAuth({
  site: SITE,
  redirectUri: REDIRECT_URI,
  store,
  platform: expoAuthPlatform((input, init) => fetch(input, init)),
  onSignedOut: () => {
    void HoursNative?.clear();
  },
});

export async function signOut() {
  await HoursNative?.forgetDevice().catch(() => undefined);
  await auth.signOut();
}
