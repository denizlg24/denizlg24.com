import Constants from "expo-constants";

const extra = Constants.expoConfig?.extra as { apiUrl?: string } | undefined;

export const API_URL = (
  extra?.apiUrl ??
  process.env.EXPO_PUBLIC_STREAM_API_URL ??
  "https://stream.denizlg24.com"
).replace(/\/+$/, "");

/** One slash: the provider only accepts a private-use scheme with no authority. */
export const REDIRECT_URI = "com.denizlg24.stream:/oauth/callback";
