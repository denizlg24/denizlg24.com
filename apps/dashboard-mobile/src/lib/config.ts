import Constants from "expo-constants";

const extra = Constants.expoConfig?.extra as
  | { site?: string; apsEnvironment?: "development" | "production" }
  | undefined;

export const SITE = extra?.site ?? "https://denizlg24.com";
export const APS_ENVIRONMENT = extra?.apsEnvironment ?? "development";
export const REDIRECT_URI = "com.denizlg24.dashboard:/oauth/callback";
