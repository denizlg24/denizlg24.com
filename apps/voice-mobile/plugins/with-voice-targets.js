// CommonJS on purpose: Expo compiles app.config.ts but requires local plugins
// as plain JavaScript.
const {
  withAppCapabilities,
  withAppSources,
  withExtensionTarget,
  withSceneLifecycle,
  withoutScriptSandboxing,
} = require("@repo/expo-ios-targets");

const SHARED = "modules/voice-native/ios/Shared";
const INTENTS = "modules/voice-native/ios/Intents";

/**
 * The widget extension (Ask widgets, the turn's Live Activity, the Control
 * Center button) and the intents behind Siri, the Action Button and the
 * Live Activity's Stop. The intents never touch the pod: Ask opens a link,
 * Stop posts a notification the module forwards to JS.
 *
 * @type {import("expo/config-plugins").ConfigPlugin}
 */
module.exports = (config) => {
  const appGroup = `group.${config.ios.bundleIdentifier}`;
  config = withAppCapabilities(config, {
    entitlements: { "com.apple.security.application-groups": [appGroup] },
  });
  config = withExtensionTarget(config, {
    name: "VoiceWidgetExtension",
    bundleSuffix: "widgets",
    displayName: "Voice",
    sources: ["targets/widgets", SHARED, INTENTS],
    deploymentTarget: "18.0",
    swiftConditions: ["VOICE_WIDGET_EXTENSION"],
    entitlements: { "com.apple.security.application-groups": [appGroup] },
    infoPlist: { VoiceAppGroup: appGroup },
  });
  config = withAppSources(config, {
    group: "VoiceIntents",
    sources: [INTENTS, "targets/app"],
  });
  config = withSceneLifecycle(config);
  return withoutScriptSandboxing(config);
};
