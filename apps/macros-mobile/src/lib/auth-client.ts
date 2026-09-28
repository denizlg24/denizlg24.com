import { expoClient } from "@better-auth/expo/client";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";
import { API_URL, APP_SCHEME } from "./config";

export const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [
    expoClient({
      scheme: APP_SCHEME,
      storagePrefix: "macros",
      // Must match `advanced.cookiePrefix` in apps/macros/lib/auth.ts, or the
      // client never recognises the session cookie in a Set-Cookie header.
      cookiePrefix: "macros",
      storage: SecureStore,
    }),
  ],
});

export type AuthSession = typeof authClient.$Infer.Session;
