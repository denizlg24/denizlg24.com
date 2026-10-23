// CommonJS on purpose: Expo compiles app.config.ts but requires local plugins
// as plain JavaScript.
const { withSceneLifecycle } = require("@repo/expo-ios-targets");

/**
 * The iOS 27 SDK refuses to launch an app without the UIScene life cycle.
 * Only iOS mods are registered, so an Android prebuild passes through.
 *
 * @type {import("expo/config-plugins").ConfigPlugin}
 */
module.exports = (config) => withSceneLifecycle(config);
