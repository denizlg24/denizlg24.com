import type { ConfigContext, ExpoConfig } from "expo/config";
import packageJson from "./package.json";

// CFBundleVersion. CI stamps the workflow run number so every published IPA
// is distinguishable to SideStore; local builds stay on 1.
const buildNumber = process.env.MACROS_IOS_BUILD_NUMBER ?? "1";
const apiUrl =
  process.env.EXPO_PUBLIC_MACROS_API_URL ?? "https://macros.denizlg24.com";

export const BUNDLE_IDENTIFIER = "com.denizlg24.macros";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Macros",
  slug: "macros",
  scheme: "macros",
  version: packageJson.version,
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  platforms: ["ios"],
  ios: {
    bundleIdentifier: BUNDLE_IDENTIFIER,
    buildNumber,
    supportsTablet: false,
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      CFBundleAllowMixedLocalizations: true,
    },
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
  ],
  extra: { apiUrl },
});
