import { describe, expect, it } from "bun:test";
import type { Database } from "@repo/cloud-core";
import {
  generatePreviewShareToken,
  revokePreviewShareGrants,
  verifyPreviewShareToken,
} from "./preview-share";

const ID = "97a12bc5-daf5-4764-97ee-04c7829fce3d";
const SECRET = "preview-share-test-secret-at-least-32-bytes";

function grantDatabase(): Database {
  let grant:
    | {
        deploymentId: string;
        expiresAt: Date | null;
        revokedAt: Date | null;
      }
    | undefined;
  return {
    insert: () => ({
      values: async (value: {
        deploymentId: string;
        expiresAt: Date | null;
      }) => {
        grant = { ...value, revokedAt: null };
      },
    }),
    update: () => ({
      set: (value: { revokedAt: Date }) => ({
        where: async () => {
          if (grant) grant.revokedAt = value.revokedAt;
        },
      }),
    }),
    query: {
      previewShareGrants: { findFirst: async () => grant },
    },
  } as unknown as Database;
}

describe("preview share tokens", () => {
  it("round-trips a deployment and expiry", async () => {
    const db = grantDatabase();
    const token = await generatePreviewShareToken(db, ID, "7d", SECRET, 1_000);
    expect(await verifyPreviewShareToken(db, token, SECRET, 2_000)).toEqual({
      deploymentId: ID,
      expiresAt: 604_801_000,
      grantId: token.split(".")[0]!,
    });
  });

  it("rejects expiry, tampering, and a different secret", async () => {
    const db = grantDatabase();
    const token = await generatePreviewShareToken(db, ID, "30m", SECRET, 1_000);
    expect(
      await verifyPreviewShareToken(db, token, SECRET, 1_801_001),
    ).toBeNull();
    expect(
      await verifyPreviewShareToken(db, `${token}0`, SECRET, 2_000),
    ).toBeNull();
    expect(
      await verifyPreviewShareToken(db, token, `${SECRET}-other`, 2_000),
    ).toBeNull();
  });

  it("supports links without expiry and persisted revocation", async () => {
    const db = grantDatabase();
    const token = await generatePreviewShareToken(
      db,
      ID,
      "never",
      SECRET,
      1_000,
    );
    expect(
      await verifyPreviewShareToken(db, token, SECRET, Number.MAX_SAFE_INTEGER),
    ).toEqual({
      deploymentId: ID,
      expiresAt: 0,
      grantId: token.split(".")[0]!,
    });
    await revokePreviewShareGrants(db, ID);
    expect(await verifyPreviewShareToken(db, token, SECRET, 2_000)).toBeNull();
  });
});
