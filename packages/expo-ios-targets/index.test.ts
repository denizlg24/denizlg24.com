import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extensionPoint, plist, swiftSources } from "./index.js";

describe("plist", () => {
  test("encodes booleans, numbers and escapes text", () => {
    const xml = plist({ A: true, B: 2, C: "a<b", D: ["x"] });
    expect(xml).toContain("<key>A</key>\n\t<true/>");
    expect(xml).toContain("<integer>2</integer>");
    expect(xml).toContain("<string>a&lt;b</string>");
  });
});

describe("swiftSources", () => {
  test("refuses two files of one name", () => {
    const root = mkdtempSync(join(tmpdir(), "targets-"));
    for (const dir of ["a", "b"]) {
      mkdirSync(join(root, dir));
      writeFileSync(join(root, dir, "Shared.swift"), "");
    }
    expect(() => swiftSources(root, ["a", "b"])).toThrow(/both a and b/);
  });
});

describe("extensionPoint", () => {
  test("widgets by default; a share extension names its controller", () => {
    expect(extensionPoint({})).toEqual({
      NSExtensionPointIdentifier: "com.apple.widgetkit-extension",
    });
    const share = extensionPoint({ kind: "share", principalClass: "Share" });
    expect(share.NSExtensionPointIdentifier).toBe("com.apple.share-services");
    expect(share.NSExtensionPrincipalClass).toBe(
      "$(PRODUCT_MODULE_NAME).Share",
    );
    expect(() => extensionPoint({ kind: "share" })).toThrow(/principalClass/);
  });
});
