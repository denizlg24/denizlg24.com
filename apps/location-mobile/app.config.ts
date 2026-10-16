import type { ConfigContext, ExpoConfig } from "expo/config";
import packageJson from "./package.json";

export const BUNDLE_IDENTIFIER = "com.denizlg24.location";
/** Not a secret: it is in every signed binary. */
const APPLE_TEAM_ID = "L6U3NB38AN";

const site = process.env.EXPO_PUBLIC_LOCATION_SITE ?? "https://denizlg24.com";
/** Device builds from Xcode are signed for development, so sandbox APNs. */
const apsEnvironment =
  process.env.LOCATION_IOS_APS_ENVIRONMENT === "production"
    ? "production"
    : "development";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Location",
  slug: "location",
  scheme: ["location", BUNDLE_IDENTIFIER],
  version: packageJson.version,
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  platforms: ["ios"],
  ios: {
    bundleIdentifier: BUNDLE_IDENTIFIER,
    appleTeamId: APPLE_TEAM_ID,
    buildNumber: process.env.LOCATION_IOS_BUILD_NUMBER ?? "1",
    supportsTablet: false,
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      LocationSite: site,
      NSLocationWhenInUseUsageDescription: "Records where you are.",
      NSLocationAlwaysAndWhenInUseUsageDescription:
        "Records where you are, including while the app is closed.",
      // The live trail keeps updating with the app in the background.
      UIBackgroundModes: ["location"],
    },
  },
  plugins: [
    "expo-router",
    [
      "expo-splash-screen",
      {
        image: "./assets/splash-icon.png",
        imageWidth: 120,
        resizeMode: "contain",
        backgroundColor: "#f9f8f6",
        dark: { backgroundColor: "#000000" },
      },
    ],
    ["expo-build-properties", { ios: { deploymentTarget: "18.0" } }],
    ["expo-notifications", { mode: apsEnvironment }],
    "./plugins/with-location-targets",
  ],
  extra: { site, apsEnvironment },
});
