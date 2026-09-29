// CommonJS on purpose: Expo compiles app.config.ts but requires local plugins
// as plain JavaScript.
const { withEntitlementsPlist } = require("expo/config-plugins");

// Expo applies expo-notifications' plugin to every build because the package
// is installed, whether app.config lists it or not, and that plugin writes
// `aps-environment`. A SideStore build must carry no entitlements at all.
/** @type {import("expo/config-plugins").ConfigPlugin} */
const withoutEntitlements = (config) =>
  withEntitlementsPlist(config, (mod) => {
    for (const key of Object.keys(mod.modResults)) delete mod.modResults[key];
    return mod;
  });

module.exports = withoutEntitlements;
