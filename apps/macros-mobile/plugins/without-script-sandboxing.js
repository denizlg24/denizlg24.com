// CommonJS on purpose: Expo compiles app.config.ts but requires local plugins
// as plain JavaScript.
const { withXcodeProject } = require("expo/config-plugins");

// The template turns on ENABLE_USER_SCRIPT_SANDBOXING while the "Bundle React
// Native code and images" phase declares no outputs, so a Release build that
// finds a main.jsbundle already in the products directory (a previous build,
// or `expo run:ios`'s eager bundle) dies on `deny file-write-unlink`.
/** @type {import("expo/config-plugins").ConfigPlugin} */
const withoutScriptSandboxing = (config) =>
  withXcodeProject(config, (mod) => {
    const configurations = mod.modResults.pbxXCBuildConfigurationSection();
    for (const entry of Object.values(configurations)) {
      if (typeof entry !== "object" || !entry.buildSettings) continue;
      entry.buildSettings.ENABLE_USER_SCRIPT_SANDBOXING = "NO";
    }
    return mod;
  });

module.exports = withoutScriptSandboxing;
