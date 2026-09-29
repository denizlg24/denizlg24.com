import Constants from "expo-constants";
import { Platform } from "react-native";

function readApiUrl(): string {
  const extra = Constants.expoConfig?.extra;
  const configured =
    extra && typeof extra.apiUrl === "string" ? extra.apiUrl : undefined;
  return (configured ?? "https://macros.denizlg24.com").replace(/\/+$/, "");
}

export const API_URL = readApiUrl();
export const APP_SCHEME = "macros";
export const APP_VERSION = Constants.expoConfig?.version ?? "0.0.0";

// Absolute on purpose: the Expo auth client turns a relative callback into a
// `macros://` deep link, and these must open the web pages that hand back.
export const NATIVE_VERIFICATION_CALLBACK = `${API_URL}/register/verified`;
export const PASSWORD_RESET_REDIRECT = `${API_URL}/register/reset-password`;

type Capabilities = { healthKit: boolean; push: boolean };

/**
 * What this build was signed to do. A SideStore build has no entitlements,
 * so HealthKit and remote push are off there and their UI stays hidden. The
 * Android APK is sideloaded with neither HealthKit nor FCM.
 */
function readCapabilities(): Capabilities {
  if (Platform.OS !== "ios") return { healthKit: false, push: false };
  const configured = Constants.expoConfig?.extra?.capabilities;
  if (!configured || typeof configured !== "object") {
    return { healthKit: false, push: false };
  }
  return {
    healthKit: configured.healthKit === true,
    push: configured.push === true,
  };
}

export const capabilities = readCapabilities();

/** What copy calls the device the app runs on. */
export const DEVICE_NAME = Platform.OS === "ios" ? "iPhone" : "phone";
