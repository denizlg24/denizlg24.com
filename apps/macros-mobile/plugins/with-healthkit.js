// CommonJS on purpose: Expo compiles app.config.ts but requires local plugins
// as plain JavaScript.
const { withEntitlementsPlist, withInfoPlist } = require("expo/config-plugins");

const SHARE_USAGE =
  "Macros reads your weight, body fat, steps and active energy to keep your trend and energy estimate current.";
const UPDATE_USAGE =
  "Macros saves the calories and macros you log so other apps can use them.";

/** @type {import("expo/config-plugins").ConfigPlugin} */
const withHealthKit = (config) => {
  config = withEntitlementsPlist(config, (mod) => {
    mod.modResults["com.apple.developer.healthkit"] = true;
    mod.modResults["com.apple.developer.healthkit.access"] = [];
    return mod;
  });
  return withInfoPlist(config, (mod) => {
    mod.modResults.NSHealthShareUsageDescription = SHARE_USAGE;
    mod.modResults.NSHealthUpdateUsageDescription = UPDATE_USAGE;
    return mod;
  });
};

module.exports = withHealthKit;
