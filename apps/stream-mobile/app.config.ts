import type { ConfigContext, ExpoConfig } from "expo/config";
import packageJson from "./package.json";
import fonts from "./plugins/fonts.cjs";

export const BUNDLE_IDENTIFIER = "com.denizlg24.stream";

const apiUrl =
  process.env.EXPO_PUBLIC_STREAM_API_URL ?? "https://stream.denizlg24.com";
const buildNumber = process.env.STREAM_IOS_BUILD_NUMBER ?? "1";
// Android refuses an APK over one with a higher code.
const versionCode = Number(process.env.STREAM_ANDROID_VERSION_CODE ?? "1");

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Stream",
  slug: "stream",
  description:
    "Your family’s films, series, shared profiles and personal picks.",
  scheme: [BUNDLE_IDENTIFIER, "stream"],
  version: packageJson.version,
  // Every screen asks for portrait except the player (`app/_layout.tsx`).
  orientation: "default",
  icon: "./assets/icon.png",
  userInterfaceStyle: "dark",
  backgroundColor: "#0c0b0a",
  platforms: ["ios", "android"],
  ios: {
    bundleIdentifier: BUNDLE_IDENTIFIER,
    buildNumber,
    supportsTablet: false,
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      CFBundleAllowMixedLocalizations: true,
    },
  },
  android: {
    package: BUNDLE_IDENTIFIER,
    versionCode,
    adaptiveIcon: {
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundColor: "#0c0b0a",
    },
    blockedPermissions: [
      "android.permission.RECORD_AUDIO",
      "android.permission.SYSTEM_ALERT_WINDOW",
    ],
  },
  plugins: [
    "expo-router",
    ["expo-font", { fonts }],
    ["expo-secure-store", { faceIDPermission: false }],
    [
      "expo-video",
      { supportsBackgroundPlayback: true, supportsPictureInPicture: true },
    ],
    [
      "expo-splash-screen",
      {
        image: "./assets/splash-icon.png",
        imageWidth: 96,
        resizeMode: "contain",
        backgroundColor: "#0c0b0a",
        dark: { backgroundColor: "#0c0b0a" },
      },
    ],
    [
      "expo-build-properties",
      {
        ios: { deploymentTarget: "17.0" },
        android: { minSdkVersion: 26 },
      },
    ],
    "./plugins/with-stream-native",
  ],
  extra: { apiUrl },
});
