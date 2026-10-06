import type { ConfigContext, ExpoConfig } from "expo/config";
import packageJson from "./package.json";

// CFBundleVersion. CI stamps the workflow run number so every store build
// increases monotonically; local builds stay on 1.
const buildNumber = process.env.MACROS_IOS_BUILD_NUMBER ?? "1";
// versionCode, the Android counterpart: Android refuses to install an APK
// over one with a higher code, so CI stamps its run number here too.
const versionCode = Number(process.env.MACROS_ANDROID_VERSION_CODE ?? "1");
const apiUrl =
  process.env.EXPO_PUBLIC_MACROS_API_URL ?? "https://macros.denizlg24.com";

export const BUNDLE_IDENTIFIER = "com.denizlg24.macros";
/** Shared by the app and its widget extension. */
export const APP_GROUP = `group.${BUNDLE_IDENTIFIER}`;

// Local Xcode builds register against sandbox APNs; CI uses production.
const apsEnvironment =
  process.env.MACROS_IOS_APS_ENVIRONMENT === "production"
    ? "production"
    : "development";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Macros",
  slug: "macros",
  scheme: "macros",
  version: packageJson.version,
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  platforms: ["ios", "android"],
  ios: {
    bundleIdentifier: BUNDLE_IDENTIFIER,
    buildNumber,
    supportsTablet: false,
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      CFBundleAllowMixedLocalizations: true,
      // Long press the icon. Handled by modules/macros-quick-actions and
      // routed in src/features/shell/quick-actions.tsx.
      UIApplicationShortcutItems: [
        {
          UIApplicationShortcutItemType: `${BUNDLE_IDENTIFIER}.search`,
          UIApplicationShortcutItemTitle: "Search Food",
          UIApplicationShortcutItemIconSymbolName: "magnifyingglass",
        },
        {
          UIApplicationShortcutItemType: `${BUNDLE_IDENTIFIER}.scan`,
          UIApplicationShortcutItemTitle: "Scan Barcode",
          UIApplicationShortcutItemIconSymbolName: "barcode.viewfinder",
        },
        {
          UIApplicationShortcutItemType: `${BUNDLE_IDENTIFIER}.quick-add`,
          UIApplicationShortcutItemTitle: "Quick Add",
          UIApplicationShortcutItemIconSymbolName: "bolt",
        },
        {
          UIApplicationShortcutItemType: `${BUNDLE_IDENTIFIER}.weigh-in`,
          UIApplicationShortcutItemTitle: "Log Weight",
          UIApplicationShortcutItemIconSymbolName: "scalemass",
        },
      ],
    },
  },
  android: {
    package: BUNDLE_IDENTIFIER,
    versionCode,
    adaptiveIcon: {
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundColor: "#F1F3E0",
    },
    blockedPermissions: [
      "android.permission.RECORD_AUDIO",
      "android.permission.SYSTEM_ALERT_WINDOW",
    ],
  },
  plugins: [
    "expo-router",
    ["expo-secure-store", { faceIDPermission: false }],
    [
      "expo-camera",
      {
        cameraPermission:
          "Macros uses the camera to scan barcodes and nutrition labels.",
        microphonePermission: false,
        recordAudioAndroid: false,
      },
    ],
    [
      "expo-image-picker",
      {
        photosPermission:
          "Macros reads photos you pick for progress pictures and nutrition labels.",
        cameraPermission:
          "Macros uses the camera to take progress pictures and scan nutrition labels.",
        microphonePermission: false,
      },
    ],
    [
      "expo-splash-screen",
      {
        image: "./assets/splash-icon.png",
        imageWidth: 96,
        resizeMode: "contain",
        backgroundColor: "#ffffff",
        dark: { backgroundColor: "#000000" },
      },
    ],
    [
      "expo-build-properties",
      {
        ios: { deploymentTarget: "17.0" },
      },
    ],
    "./plugins/with-scene-lifecycle",
    "./plugins/without-script-sandboxing",
    "./plugins/with-android-colors",
    "./plugins/with-android-signing",
    "./plugins/with-widgets",
    "./plugins/with-healthkit",
    ["expo-notifications", { mode: apsEnvironment }],
  ],
  extra: {
    apiUrl,
  },
});
