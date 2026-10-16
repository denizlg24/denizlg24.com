// CommonJS on purpose: Expo compiles app.config.ts but requires local plugins
// as plain JavaScript.
const {
  withAppCapabilities,
  withAppSources,
  withExtensionTarget,
  withoutScriptSandboxing,
  withSceneLifecycle,
} = require("@repo/expo-ios-targets");

const SHARED = "modules/dashboard-native/ios/Shared";
const INTENTS = "modules/dashboard-native/ios/Intents";

/**
 * The widget extension (Today, board todos, next class, budget headroom,
 * watchlist), the share extension that saves notes, and the App Intents
 * behind the interactive todo widget, Siri and Shortcuts.
 *
 * As in Hours, the intents are compiled into the app too, because Xcode
 * extracts App Shortcuts metadata from the app's own sources only; there they
 * use the `DashboardNative` pod's copy of `Shared/`, and the extension, which
 * links no pods, compiles its own.
 *
 * @type {import("expo/config-plugins").ConfigPlugin}
 */
module.exports = (config) => {
  const appGroup = `group.${config.ios.bundleIdentifier}`;
  const shared = {
    DashboardAppGroup: appGroup,
    DashboardSite: config.ios.infoPlist.DashboardSite,
  };
  config = withAppCapabilities(config, {
    entitlements: {
      "com.apple.security.application-groups": [appGroup],
      "com.apple.developer.usernotifications.time-sensitive": true,
    },
  });
  config = withExtensionTarget(config, {
    name: "DashboardWidgetExtension",
    bundleSuffix: "widgets",
    displayName: "Dashboard",
    sources: ["targets/widgets", SHARED, INTENTS],
    deploymentTarget: "18.0",
    swiftConditions: ["DASHBOARD_WIDGET_EXTENSION"],
    entitlements: { "com.apple.security.application-groups": [appGroup] },
    infoPlist: shared,
  });
  // URL, text or image from any app's share sheet becomes a note.
  config = withExtensionTarget(config, {
    name: "DashboardShareExtension",
    kind: "share",
    principalClass: "ShareViewController",
    bundleSuffix: "share",
    displayName: "Dashboard",
    sources: ["targets/share", SHARED],
    deploymentTarget: "18.0",
    swiftConditions: ["DASHBOARD_SHARE_EXTENSION"],
    entitlements: { "com.apple.security.application-groups": [appGroup] },
    infoPlist: shared,
  });
  config = withAppSources(config, {
    group: "DashboardIntents",
    sources: [INTENTS, "targets/app"],
  });
  config = withSceneLifecycle(config);
  return withoutScriptSandboxing(config);
};
