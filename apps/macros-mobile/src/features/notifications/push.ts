import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { registerPushDevice, unregisterPushDevice } from "@/api/notifications";
import { capabilities } from "@/lib/config";
import { notificationPermission } from "./permissions";

const FALLBACK_BUNDLE_ID = "com.denizlg24.macros";
const UNREGISTER_TIMEOUT_MS = 3000;

let currentToken: string | null = null;
let registered = false;

function tokenData(token: Notifications.DevicePushToken): string | null {
  return token.type === "ios" && typeof token.data === "string"
    ? token.data
    : null;
}

/**
 * A local development build is signed for the APNs sandbox; TestFlight and
 * App Store builds use production.
 */
async function sendToken(token: string) {
  currentToken = token;
  registered = false;
  await registerPushDevice({
    token,
    environment: __DEV__ ? "sandbox" : "production",
    bundleId: Constants.expoConfig?.ios?.bundleIdentifier ?? FALLBACK_BUNDLE_ID,
  });
  registered = true;
}

/**
 * Only builds carrying the push entitlement can get a token, and only once
 * the user has allowed notifications — this never prompts.
 */
export async function registerForRemotePush(): Promise<void> {
  if (!capabilities.push) return;
  if ((await notificationPermission()) !== "granted") return;
  const token = tokenData(await Notifications.getDevicePushTokenAsync());
  if (token) await sendToken(token);
}

/** For foregrounding: retries only until one registration has landed. */
export async function ensureRemotePushRegistered(): Promise<void> {
  if (registered) return;
  await registerForRemotePush();
}

export function onPushTokenChanged(): () => void {
  if (!capabilities.push) return () => undefined;
  const subscription = Notifications.addPushTokenListener((next) => {
    const token = tokenData(next);
    if (token && token !== currentToken) {
      sendToken(token).catch(() => undefined);
    }
  });
  return () => subscription.remove();
}

/**
 * Best effort and bounded: signing out must not wait on a dead network. A
 * token left behind is harmless — it moves to whoever signs in next here,
 * and APNs retires it if the app is removed.
 */
export async function unregisterFromRemotePush(): Promise<void> {
  const token = currentToken;
  if (!token) return;
  currentToken = null;
  registered = false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UNREGISTER_TIMEOUT_MS);
  try {
    await unregisterPushDevice(token, controller.signal);
  } catch {
    // Signing out goes ahead regardless.
  } finally {
    clearTimeout(timer);
  }
}
