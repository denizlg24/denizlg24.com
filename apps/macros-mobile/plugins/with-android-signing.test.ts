import { describe, expect, test } from "bun:test";
import {
  addReleaseSigning,
  hasReleaseSigning,
} from "./with-android-signing.js";

// The signing section of expo-template-bare-minimum@57's app/build.gradle.
const TEMPLATE = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            minifyEnabled enableMinifyInReleaseBuilds
        }
    }
}
`;

const ENV = {
  MACROS_ANDROID_KEYSTORE: "AAAA",
  MACROS_ANDROID_KEYSTORE_PASSWORD: "store",
  MACROS_ANDROID_KEY_ALIAS: "macros",
  MACROS_ANDROID_KEY_PASSWORD: "key",
};

describe("addReleaseSigning", () => {
  const signed = addReleaseSigning(TEMPLATE);

  test("signs release builds with the release key", () => {
    expect(signed).toContain("storeFile file('macros-release.keystore')");
    expect(signed).toMatch(
      /release \{\n(?: {12}\/\/[^\n]*\n)* {12}signingConfig signingConfigs\.release\n/,
    );
  });

  test("keeps debug builds on the debug key", () => {
    expect(signed).toContain(
      "debug {\n            signingConfig signingConfigs.debug\n        }",
    );
  });

  test("reads passwords from the environment, never writes them", () => {
    expect(signed).toContain(
      "storePassword System.getenv('MACROS_ANDROID_KEYSTORE_PASSWORD')",
    );
    expect(signed).not.toContain("'store'");
  });

  test("is idempotent", () => {
    expect(addReleaseSigning(signed)).toBe(signed);
  });

  test("refuses a template it does not recognise", () => {
    expect(() =>
      addReleaseSigning(
        TEMPLATE.replace(
          "            signingConfig signingConfigs.debug\n            minify",
          "            minify",
        ),
      ),
    ).toThrow(/release build type/);
  });
});

describe("hasReleaseSigning", () => {
  test("needs every variable", () => {
    expect(hasReleaseSigning(ENV)).toBe(true);
    expect(
      hasReleaseSigning({ ...ENV, MACROS_ANDROID_KEY_PASSWORD: " " }),
    ).toBe(false);
    expect(hasReleaseSigning({})).toBe(false);
  });
});
