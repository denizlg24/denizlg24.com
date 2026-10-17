// CommonJS on purpose: Expo compiles app.config.ts but requires local plugins
// as plain JavaScript.
const {
  withAppCapabilities,
  withAppSources,
  withExtensionTarget,
  withoutScriptSandboxing,
  withSceneLifecycle,
} = require("@repo/expo-ios-targets");

const SHARED = "modules/location-native/ios/Shared";
const INTENTS = "modules/location-native/ios/Intents";

/**
 * The widget extension (the Explore and Map widgets, the Control Center
 * toggle) and the App Intents behind their buttons, Siri and the Action
 * Button. The App Group carries the exploration both sides draw from.
 *
 * The intents are compiled into the app too: a `LiveActivityIntent` runs in
 * the app's process, the only one that can start location updates, and
 * Xcode extracts App Shortcuts metadata from the app's own sources only.
 * There they use the `LocationNative` pod's copy of `Shared/`; the
 * extension, which links no pods, compiles its own.
 *
 * Time-sensitive notifications let a message through a Focus. The iOS 27 SDK
 * refuses to launch an app without the UIScene life cycle.
 *
 * @type {import("expo/config-plugins").ConfigPlugin}
 */
module.exports = (config) => {
  const appGroup = `group.${config.ios.bundleIdentifier}`;
  config = withAppCapabilities(config, {
    entitlements: {
      "com.apple.security.application-groups": [appGroup],
      "com.apple.developer.usernotifications.time-sensitive": true,
    },
    infoPlist: { LocationAppGroup: appGroup },
  });
  config = withExtensionTarget(config, {
    name: "LocationWidgetExtension",
    bundleSuffix: "widgets",
    displayName: "Location",
    sources: ["targets/widgets", SHARED, INTENTS],
    deploymentTarget: "18.0",
    swiftConditions: ["LOCATION_WIDGET_EXTENSION"],
    entitlements: { "com.apple.security.application-groups": [appGroup] },
    infoPlist: { LocationAppGroup: appGroup },
  });
  config = withAppSources(config, {
    group: "LocationIntents",
    sources: [INTENTS, "targets/app"],
  });
  config = withSceneLifecycle(config);
  return withoutScriptSandboxing(config);
};
