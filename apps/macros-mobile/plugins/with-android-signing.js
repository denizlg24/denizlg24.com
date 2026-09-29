// CommonJS on purpose: Expo compiles app.config.ts but requires local plugins
// as plain JavaScript.
const fs = require("node:fs");
const path = require("node:path");
const { withAppBuildGradle, withDangerousMod } = require("expo/config-plugins");

// Release signing for the sideloaded APK. Without every variable the template
// is left alone and a release build is signed with the debug key, which is
// what pull-request builds want. The passwords stay in the environment: the
// generated build.gradle reads them when Gradle runs, so they never land in a
// file.
const ENV = {
  keystore: "MACROS_ANDROID_KEYSTORE",
  storePassword: "MACROS_ANDROID_KEYSTORE_PASSWORD",
  keyAlias: "MACROS_ANDROID_KEY_ALIAS",
  keyPassword: "MACROS_ANDROID_KEY_PASSWORD",
};

const KEYSTORE_FILE = "macros-release.keystore";

const SIGNING_CONFIGS = "    signingConfigs {\n";
const RELEASE_SIGNING_CONFIG = `        release {
            storeFile file('${KEYSTORE_FILE}')
            storePassword System.getenv('${ENV.storePassword}')
            keyAlias System.getenv('${ENV.keyAlias}')
            keyPassword System.getenv('${ENV.keyPassword}')
        }
`;
const RELEASE_BUILD_TYPE =
  /(\n {8}release \{\n(?: {12}\/\/[^\n]*\n)*) {12}signingConfig signingConfigs\.debug\n/;

/**
 * @param {Record<string, string | undefined>} env
 * @returns {boolean}
 */
function hasReleaseSigning(env) {
  return Object.values(ENV).every((name) => Boolean(env[name]?.trim()));
}

/**
 * @param {string} gradle android/app/build.gradle from the Expo template
 * @returns {string}
 */
function addReleaseSigning(gradle) {
  if (gradle.includes(`storeFile file('${KEYSTORE_FILE}')`)) return gradle;
  if (!gradle.includes(SIGNING_CONFIGS)) {
    throw new Error(
      "with-android-signing: app/build.gradle no longer declares `signingConfigs {`; check the Expo template.",
    );
  }
  if (!RELEASE_BUILD_TYPE.test(gradle)) {
    throw new Error(
      "with-android-signing: the release build type no longer signs with signingConfigs.debug; check the Expo template.",
    );
  }
  return gradle
    .replace(SIGNING_CONFIGS, SIGNING_CONFIGS + RELEASE_SIGNING_CONFIG)
    .replace(
      RELEASE_BUILD_TYPE,
      "$1            signingConfig signingConfigs.release\n",
    );
}

/** @type {import("expo/config-plugins").ConfigPlugin} */
const withAndroidSigning = (config) => {
  if (!hasReleaseSigning(process.env)) return config;

  config = withDangerousMod(config, [
    "android",
    (mod) => {
      const keystore = Buffer.from(process.env[ENV.keystore] ?? "", "base64");
      fs.writeFileSync(
        path.join(mod.modRequest.platformProjectRoot, "app", KEYSTORE_FILE),
        keystore,
        { mode: 0o600 },
      );
      return mod;
    },
  ]);

  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== "groovy") {
      throw new Error(
        "with-android-signing: expected a Groovy app/build.gradle from the Expo template.",
      );
    }
    mod.modResults.contents = addReleaseSigning(mod.modResults.contents);
    return mod;
  });
};

module.exports = withAndroidSigning;
module.exports.addReleaseSigning = addReleaseSigning;
module.exports.hasReleaseSigning = hasReleaseSigning;
