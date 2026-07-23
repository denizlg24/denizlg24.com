import { describe, expect, it } from "bun:test";

import type { SafeUserRecord } from "../services/types";
import { checkStorageAccess } from "./access";
import {
  isProjectPath,
  joinPath,
  normalizeFileName,
  PathValidationError,
  resolveHddDiskPath,
  resolveSsdDiskPath,
  validatePath,
} from "./path";
import { generateShareToken, verifyShareToken } from "./share";

const user = {
  id: "10000000-0000-4000-8000-000000000001",
  username: "owner",
  email: "owner@example.com",
  role: "user",
  status: "active",
  totpEnabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
} satisfies SafeUserRecord;

describe("storage path and access contracts", () => {
  it("preserves virtual and physical path layout", () => {
    expect(joinPath("/project", "folder", "file.txt")).toBe(
      "/project/folder/file.txt",
    );
    expect(resolveSsdDiskPath("/mnt/ssd/storage", "/project/file.txt")).toBe(
      "/mnt/ssd/storage/project/file.txt",
    );
    expect(
      resolveHddDiskPath(
        "/mnt/hdd/storage",
        "20000000-0000-4000-8000-000000000002",
      ),
    ).toBe("/mnt/hdd/storage/20000000-0000-4000-8000-000000000002");
    expect(normalizeFileName("Quarterly Report.PDF")).toBe(
      "quarterly_report.pdf",
    );
  });

  it("rejects traversal and unsafe segments", () => {
    expect(() => validatePath("/safe/../escape")).toThrow(PathValidationError);
    expect(() => validatePath("/safe\\escape")).toThrow(PathValidationError);
    expect(() => validatePath("//double")).toThrow(PathValidationError);
  });

  it("enforces the project folder boundary segment-wise", () => {
    expect(isProjectPath("/alpha/file.txt", "alpha")).toBe(true);
    expect(isProjectPath("/alphabet/file.txt", "alpha")).toBe(false);
    expect(
      checkStorageAccess(
        {
          user,
          project: {
            id: "30000000-0000-4000-8000-000000000003",
            name: "Alpha",
            slug: "alpha",
            description: null,
            ownerId: user.id,
            storageFolderId: null,
            meiliApiKeyUid: null,
            meiliApiKey: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          scopes: ["storage:read"],
        },
        "/beta/file.txt",
        "storage:read",
        user.id,
        "read",
      ),
    ).toEqual({
      allowed: false,
      code: "ACCESS_DENIED",
      message: "Resource is outside project scope",
    });
  });
});

describe("share-link HMAC wire contract", () => {
  it("matches a fixed legacy token vector", () => {
    const token = generateShareToken(
      "40000000-0000-4000-8000-000000000004",
      "1d",
      "legacy-jwt-secret",
      1_700_000_000_000,
    );
    expect(token).toBe(
      "40000000-0000-4000-8000-000000000004.1700086400000.1418cd7347b50f8a50211edd8b55e8bac5fa30ac7ccda419471b64ae538c17c5",
    );
    expect(
      verifyShareToken(token, "legacy-jwt-secret", 1_700_000_000_001),
    ).toEqual({
      fileId: "40000000-0000-4000-8000-000000000004",
      expiresAt: 1_700_086_400_000,
    });
  });

  it("rejects tampering, expiry, and malformed hex", () => {
    const token = generateShareToken("file-id", "30m", "secret", 100);
    expect(verifyShareToken(`${token}0`, "secret", 101)).toBeNull();
    expect(verifyShareToken(token, "secret", 1_800_101)).toBeNull();
    expect(verifyShareToken("file.0.zz", "secret", 101)).toBeNull();
  });
});
