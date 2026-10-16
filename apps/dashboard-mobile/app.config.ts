import type { ConfigContext, ExpoConfig } from "expo/config";
import packageJson from "./package.json";

export const BUNDLE_IDENTIFIER = "com.denizlg24.dashboard";
/** Shared by the app, its widgets and the Share extension: the Today snapshot and the session keychain item. */
export const APP_GROUP = `group.${BUNDLE_IDENTIFIER}`;
/** Not a secret: it is in every signed binary. */
const APPLE_TEAM_ID = "L6U3NB38AN";

const site = process.env.EXPO_PUBLIC_DASHBOARD_SITE ?? "https://denizlg24.com";
// Builds from this Mac carry a development profile, which registers with
// sandbox APNs; the server stores the environment with each device.
const apsEnvironment =
  process.env.DASHBOARD_IOS_APS_ENVIRONMENT === "production"
    ? "production"
    : "development";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Dashboard",
  slug: "dashboard",
  scheme: ["dashboard", BUNDLE_IDENTIFIER],
  version: packageJson.version,
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  platforms: ["ios"],
  ios: {
    bundleIdentifier: BUNDLE_IDENTIFIER,
    appleTeamId: APPLE_TEAM_ID,
    buildNumber: process.env.DASHBOARD_IOS_BUILD_NUMBER ?? "1",
    supportsTablet: false,
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      DashboardAppGroup: APP_GROUP,
      DashboardSite: site,
      DashboardApsEnvironment: apsEnvironment,
      LSApplicationQueriesSchemes: ["hours"],
    },
  },
  plugins: [
    "expo-router",
    [
      "expo-splash-screen",
      {
        image: "./assets/splash-icon.png",
        imageWidth: 96,
        resizeMode: "contain",
        backgroundColor: "#f9f8f6",
        dark: { backgroundColor: "#000000" },
      },
    ],
    ["expo-build-properties", { ios: { deploymentTarget: "18.0" } }],
    ["expo-notifications", { mode: apsEnvironment }],
    "./plugins/with-dashboard-targets",
  ],
  extra: { site, apsEnvironment },
});
