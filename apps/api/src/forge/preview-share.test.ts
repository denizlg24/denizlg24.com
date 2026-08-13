import { describe, expect, it } from "bun:test";

import {
  generatePreviewShareToken,
  verifyPreviewShareToken,
} from "./preview-share";

const ID = "97a12bc5-daf5-4764-97ee-04c7829fce3d";
const SECRET = "preview-share-test-secret-at-least-32-bytes";

describe("preview share tokens", () => {
  it("round-trips a deployment and expiry", () => {
    const token = generatePreviewShareToken(ID, "7d", SECRET, 1_000);
    expect(verifyPreviewShareToken(token, SECRET, 2_000)).toEqual({
      deploymentId: ID,
      expiresAt: 604_801_000,
    });
  });

  it("rejects expiry, tampering, and a different secret", () => {
    const token = generatePreviewShareToken(ID, "30m", SECRET, 1_000);
    expect(verifyPreviewShareToken(token, SECRET, 1_801_001)).toBeNull();
    expect(verifyPreviewShareToken(`${token}0`, SECRET, 2_000)).toBeNull();
    expect(verifyPreviewShareToken(token, `${SECRET}-other`, 2_000)).toBeNull();
  });

  it("supports links without expiry", () => {
    const token = generatePreviewShareToken(ID, "never", SECRET, 1_000);
    expect(
      verifyPreviewShareToken(token, SECRET, Number.MAX_SAFE_INTEGER),
    ).toEqual({
      deploymentId: ID,
      expiresAt: 0,
    });
  });
});
