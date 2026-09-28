import { describe, expect, test } from "bun:test";
import {
  type AppListing,
  assertReleaseMetadata,
  compareVersionsDescending,
  composeSource,
  privacyFromInfoPlist,
  type ReleaseMetadata,
  type SourceListing,
} from "./sidestore-source";

const source: SourceListing = {
  name: "Macros",
  subtitle: "Macros for iPhone",
  description: "Builds of the Macros iOS app.",
  iconURL: "https://example.com/icon.png",
  website: "https://macros.denizlg24.com",
  tintColor: "#111111",
};

const app: AppListing = {
  name: "Macros",
  bundleIdentifier: "com.denizlg24.macros",
  developerName: "Deniz",
  subtitle: "Nutrition tracking",
  localizedDescription: "Track food, weight and energy expenditure.",
  iconURL: "https://example.com/icon.png",
  tintColor: "#111111",
  category: "lifestyle",
};

function release(version: string, overrides: Partial<ReleaseMetadata> = {}) {
  return {
    version,
    buildNumber: "7",
    date: "2026-09-26T10:00:00Z",
    size: 1234,
    downloadURL: `https://example.com/Macros-${version}.ipa`,
    minOSVersion: "17.0",
    localizedDescription: `Release ${version}`,
    privacy: { NSCameraUsageDescription: "Camera" },
    entitlements: [],
    ...overrides,
  } satisfies ReleaseMetadata;
}

describe("compareVersionsDescending", () => {
  test("orders numerically, not lexically", () => {
    const versions = ["0.9.0", "0.10.0", "0.2.1", "1.0"];
    expect(versions.sort(compareVersionsDescending)).toEqual([
      "1.0",
      "0.10.0",
      "0.9.0",
      "0.2.1",
    ]);
  });
});

describe("composeSource", () => {
  test("lists newest first and takes permissions from the newest build", () => {
    const composed = composeSource(source, app, [
      release("0.1.0", { privacy: { NSCameraUsageDescription: "Old" } }),
      release("0.2.0", {
        privacy: {
          NSPhotoLibraryUsageDescription: "Photos",
          NSCameraUsageDescription: "Camera",
        },
      }),
    ]);
    const listed = composed.apps[0];
    expect(listed?.versions.map((v) => v.version)).toEqual(["0.2.0", "0.1.0"]);
    expect(listed?.appPermissions.privacy).toEqual({
      NSCameraUsageDescription: "Camera",
      NSPhotoLibraryUsageDescription: "Photos",
    });
  });

  test("never publishes the fields that make SideStore reject a source", () => {
    const composed = composeSource(source, app, [release("0.1.0")]);
    const serialised = JSON.stringify(composed);
    expect(serialised).not.toContain("marketplaceID");
    expect(serialised).not.toContain("buildVersion");
  });

  test("drops a re-published duplicate version", () => {
    const composed = composeSource(source, app, [
      release("0.1.0"),
      release("0.1.0", { downloadURL: "https://example.com/dupe.ipa" }),
    ]);
    expect(composed.apps[0]?.versions).toHaveLength(1);
  });

  test("refuses an empty release list", () => {
    expect(() => composeSource(source, app, [])).toThrow();
  });
});

describe("assertReleaseMetadata", () => {
  test("accepts a complete record", () => {
    expect(assertReleaseMetadata(release("1.2.3")).version).toBe("1.2.3");
  });

  test("rejects a version SideStore cannot compare", () => {
    expect(() => assertReleaseMetadata(release("1.2.3-beta"))).toThrow();
  });

  test("rejects a missing size", () => {
    expect(() =>
      assertReleaseMetadata(release("1.0.0", { size: 0 })),
    ).toThrow();
  });
});

describe("privacyFromInfoPlist", () => {
  test("keeps only usage descriptions", () => {
    expect(
      privacyFromInfoPlist({
        CFBundleName: "Macros",
        NSCameraUsageDescription: "Camera",
        NSAppTransportSecurity: { NSAllowsArbitraryLoads: false },
      }),
    ).toEqual({ NSCameraUsageDescription: "Camera" });
  });
});
