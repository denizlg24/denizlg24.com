// CommonJS on purpose: Expo compiles app.config.ts but requires local plugins
// as plain JavaScript.
const fs = require("node:fs");
const path = require("node:path");
const {
  AndroidConfig,
  withAndroidColors,
  withAndroidColorsNight,
  withAndroidStyles,
  withDangerousMod,
} = require("expo/config-plugins");

// Android has no counterpart to iOS's semantic system colours, and passing an
// iOS name to PlatformColor throws there. `colors` in src/ui/theme.ts reads
// these resources on Android instead; the values are iOS's own, so both
// platforms draw the same monochrome palette and the night variant follows
// the system's dark mode. `#AARRGGBB`, as Android resources expect.
const palette = {
  label: ["#FF000000", "#FFFFFFFF"],
  secondaryLabel: ["#993C3C43", "#99EBEBF5"],
  tertiaryLabel: ["#4D3C3C43", "#4DEBEBF5"],
  quaternaryLabel: ["#2E3C3C43", "#29EBEBF5"],
  placeholder: ["#4D3C3C43", "#4DEBEBF5"],
  background: ["#FFFFFFFF", "#FF000000"],
  secondaryBackground: ["#FFF2F2F7", "#FF1C1C1E"],
  tertiaryBackground: ["#FFFFFFFF", "#FF2C2C2E"],
  groupedBackground: ["#FFF2F2F7", "#FF000000"],
  secondaryGroupedBackground: ["#FFFFFFFF", "#FF1C1C1E"],
  separator: ["#4A3C3C43", "#A6545458"],
  opaqueSeparator: ["#FFC6C6C8", "#FF38383A"],
  fill: ["#33787880", "#5C787880"],
  secondaryFill: ["#29787880", "#52787880"],
  tertiaryFill: ["#1F767680", "#3D767680"],
  quaternaryFill: ["#14747480", "#2E767680"],
  link: ["#FF007AFF", "#FF0984FF"],
  destructive: ["#FFFF3B30", "#FFFF453A"],
  success: ["#FF34C759", "#FF30D158"],
  warning: ["#FFFF9500", "#FFFF9F0A"],
};

/**
 * @param {string} key a key of `palette`
 * @returns {string} the colour resource name, e.g. `macros_secondary_label`
 */
function resourceName(key) {
  return `macros_${key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}`;
}

/**
 * @param {import("expo/config-plugins").AndroidConfig.Resources.ResourceXML} xml
 * @param {0 | 1} scheme 0 for light, 1 for dark
 */
function assignPalette(xml, scheme) {
  let result = xml;
  for (const [key, values] of Object.entries(palette)) {
    result = AndroidConfig.Colors.assignColorValue(result, {
      name: resourceName(key),
      value: values[scheme],
    });
  }
  return result;
}

// The colours are only ever looked up by name, which resource shrinking
// cannot see.
const KEEP_XML = `<?xml version="1.0" encoding="utf-8"?>
<resources xmlns:tools="http://schemas.android.com/tools" tools:keep="@color/macros_*" />
`;

// Native widgets (switches, text cursors, selection handles) accent with the
// label colour rather than AppCompat's teal, as the tint does on iOS.
const ACCENT_ITEMS = ["colorAccent", "colorControlActivated"];

/** @type {import("expo/config-plugins").ConfigPlugin} */
const withMacrosAndroidColors = (config) => {
  config = withAndroidColors(config, (mod) => {
    mod.modResults = assignPalette(mod.modResults, 0);
    return mod;
  });
  config = withAndroidColorsNight(config, (mod) => {
    mod.modResults = assignPalette(mod.modResults, 1);
    return mod;
  });
  config = withAndroidStyles(config, (mod) => {
    for (const name of ACCENT_ITEMS) {
      mod.modResults = AndroidConfig.Styles.assignStylesValue(mod.modResults, {
        add: true,
        parent: AndroidConfig.Styles.getAppThemeGroup(),
        name,
        value: `@color/${resourceName("label")}`,
      });
    }
    return mod;
  });
  return withDangerousMod(config, [
    "android",
    (mod) => {
      const raw = path.join(
        mod.modRequest.platformProjectRoot,
        "app/src/main/res/raw",
      );
      fs.mkdirSync(raw, { recursive: true });
      fs.writeFileSync(path.join(raw, "macros_keep.xml"), KEEP_XML);
      return mod;
    },
  ]);
};

module.exports = withMacrosAndroidColors;
module.exports.palette = palette;
module.exports.resourceName = resourceName;
