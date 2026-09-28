import Constants from "expo-constants";

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
