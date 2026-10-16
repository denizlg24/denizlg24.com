// CommonJS on purpose: Expo compiles app.config.ts but requires local plugins
// as plain JavaScript.
const {
  withAppCapabilities,
  withSceneLifecycle,
} = require("@repo/expo-ios-targets");

/**
 * No extension targets yet. Time-sensitive notifications let a message about
 * the shop he is standing in through a Focus. The iOS 27 SDK refuses to
 * launch an app without the UIScene life cycle, which Expo 57's template
 * still lacks.
 *
 * @type {import("expo/config-plugins").ConfigPlugin}
 */
module.exports = (config) => {
  config = withAppCapabilities(config, {
    entitlements: {
      "com.apple.developer.usernotifications.time-sensitive": true,
    },
  });
  return withSceneLifecycle(config);
};
