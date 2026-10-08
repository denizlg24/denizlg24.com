import { createNativeAuth, type SessionStore } from "@repo/native-auth";
import { expoAuthPlatform } from "@repo/native-auth/expo";
import * as SecureStore from "expo-secure-store";
import { REDIRECT_URI, SITE } from "./config";

const KEY = "session";

const store: SessionStore = {
  read: () => SecureStore.getItemAsync(KEY),
  write: async (json) => {
    if (json) await SecureStore.setItemAsync(KEY, json);
    else await SecureStore.deleteItemAsync(KEY);
  },
};

export const auth = createNativeAuth({
  site: SITE,
  redirectUri: REDIRECT_URI,
  store,
  platform: expoAuthPlatform((input, init) => fetch(input, init)),
});
