import { LocationNative } from "@modules/location-native";
import { createNativeAuth, type SessionStore } from "@repo/native-auth";
import { expoAuthPlatform } from "@repo/native-auth/expo";
import { REDIRECT_URI, SITE } from "./config";

let memory: string | null = null;

/**
 * The keychain the native uploader reads, so a background relaunch with no
 * JavaScript can still sign its requests. Expo Go keeps it in memory.
 */
const store: SessionStore = {
  read: async () => (LocationNative ? LocationNative.getSession() : memory),
  write: async (json) => {
    if (LocationNative) LocationNative.setSession(json);
    else memory = json;
  },
};

export const auth = createNativeAuth({
  site: SITE,
  redirectUri: REDIRECT_URI,
  store,
  platform: expoAuthPlatform((input, init) => fetch(input, init)),
});
