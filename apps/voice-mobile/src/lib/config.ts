import Constants from "expo-constants";

const extra = Constants.expoConfig?.extra as { site?: string } | undefined;

export const SITE = extra?.site ?? "https://denizlg24.com";
export const REDIRECT_URI = "com.denizlg24.voice:/oauth/callback";
