// CommonJS on purpose: Expo compiles app.config.ts but requires local plugins
// as plain JavaScript.
const fs = require("node:fs");
const path = require("node:path");
const {
  AndroidConfig,
  withAndroidManifest,
  withDangerousMod,
} = require("expo/config-plugins");

const BANNER = "tv_banner";
const LEANBACK_LAUNCHER = "android.intent.category.LEANBACK_LAUNCHER";

/**
 * Lists the app on Google TV's home screen and lets the Play Store and the
 * installer treat it as a TV app. The same APK still installs on phones:
 * leanback and touch are declared optional, not required.
 *
 * @param {import("expo/config-plugins").AndroidManifest} manifest
 */
function addTelevision(manifest) {
  const root = manifest.manifest;
  const features = root["uses-feature"] ?? [];
  for (const name of [
    "android.software.leanback",
    "android.hardware.touchscreen",
  ]) {
    if (!features.some((feature) => feature.$["android:name"] === name)) {
      features.push({
        $: { "android:name": name, "android:required": "false" },
      });
    }
  }
  root["uses-feature"] = features;

  const application =
    AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  application.$["android:banner"] = `@drawable/${BANNER}`;

  const activity = AndroidConfig.Manifest.getMainActivityOrThrow(manifest);
  const launcher = (activity["intent-filter"] ?? []).find((filter) =>
    (filter.action ?? []).some(
      (action) => action.$["android:name"] === "android.intent.action.MAIN",
    ),
  );
  if (!launcher) throw new Error("with-android-tv: no MAIN intent filter");
  const categories = launcher.category ?? [];
  if (!categories.some((c) => c.$["android:name"] === LEANBACK_LAUNCHER)) {
    categories.push({ $: { "android:name": LEANBACK_LAUNCHER } });
  }
  launcher.category = categories;
  return manifest;
}

/** @type {import("expo/config-plugins").ConfigPlugin} */
module.exports = (config) => {
  const withManifest = withAndroidManifest(config, (next) => {
    next.modResults = addTelevision(next.modResults);
    return next;
  });
  // The launcher draws the banner at 320 × 180 xhdpi; `bun run icons` makes it.
  return withDangerousMod(withManifest, [
    "android",
    (next) => {
      const directory = path.join(
        next.modRequest.platformProjectRoot,
        "app/src/main/res/drawable-xhdpi",
      );
      fs.mkdirSync(directory, { recursive: true });
      fs.copyFileSync(
        path.join(next.modRequest.projectRoot, "assets/tv-banner.png"),
        path.join(directory, `${BANNER}.png`),
      );
      return next;
    },
  ]);
};

module.exports.addTelevision = addTelevision;
