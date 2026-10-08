// CommonJS on purpose: Expo compiles app.config.ts but requires local plugins
// as plain JavaScript.
const {
  withAppCapabilities,
  withAppSources,
  withExtensionTarget,
  withoutScriptSandboxing,
  withSceneLifecycle,
} = require("@repo/expo-ios-targets");

const SHARED = "modules/hours-native/ios/Shared";
const INTENTS = "modules/hours-native/ios/Intents";

/**
 * The widget extension (Home and Lock Screen widgets, the shift Live
 * Activity, Control Center controls) and the App Intents behind every button
 * in them, Siri and the Action Button.
 *
 * The intents are compiled into the app too: a `LiveActivityIntent` runs in
 * the app's process, which is the only one allowed to change an activity,
 * and Xcode extracts App Shortcuts metadata from the app's own sources only.
 * There they use the `HoursNative` pod's copy of `Shared/`; the extension,
 * which links no pods, compiles its own.
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
  });
  config = withExtensionTarget(config, {
    name: "HoursWidgetExtension",
    bundleSuffix: "widgets",
    displayName: "Hours",
    sources: ["targets/widgets", SHARED, INTENTS],
    deploymentTarget: "18.0",
    swiftConditions: ["HOURS_WIDGET_EXTENSION"],
    entitlements: { "com.apple.security.application-groups": [appGroup] },
    infoPlist: {
      HoursAppGroup: appGroup,
      HoursSite: config.ios.infoPlist.HoursSite,
    },
  });
  config = withAppSources(config, {
    group: "HoursIntents",
    sources: [INTENTS, "targets/app"],
  });
  config = withSceneLifecycle(config);
  return withoutScriptSandboxing(config);
};
