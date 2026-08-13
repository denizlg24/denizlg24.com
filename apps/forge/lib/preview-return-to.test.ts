import { describe, expect, it } from "bun:test";

import { safePreviewReturnTo } from "./preview-return-to";

describe("safePreviewReturnTo", () => {
  it("accepts generated deployment hostnames and preserves deep links", () => {
    expect(
      safePreviewReturnTo(
        "https://my-app-feature-abc123.denizlg24.com/docs?tab=api",
      ),
    ).toBe("https://my-app-feature-abc123.denizlg24.com/docs?tab=api");
  });

  it("rejects external, credentialed, and stable hostnames", () => {
    expect(safePreviewReturnTo("https://example.com/")).toBeNull();
    expect(
      safePreviewReturnTo(
        "https://user:pass@my-app-feature-abc123.denizlg24.com/",
      ),
    ).toBeNull();
    expect(safePreviewReturnTo("https://forge.denizlg24.com/")).toBeNull();
  });
});
