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

const OTHER_OWNER = "10000000-0000-4000-8000-000000000002";

function access(
  path: string,
  mode: "read" | "modify",
  ownerId: string | null,
  actor: SafeUserRecord = user,
) {
  return checkStorageAccess(
    { user: actor },
    path,
    mode === "read" ? "storage:read" : "storage:write",
    ownerId,
    mode,
  );
}

describe("shared storage is communal", () => {
  it("lets any account read and modify another's file there", () => {
    expect(access("/shared/notes.txt", "read", OTHER_OWNER).allowed).toBe(true);
    // The point of the change: two people editing one document in /shared, and
    // the second one's save no longer 403s.
    expect(access("/shared/notes.txt", "modify", OTHER_OWNER).allowed).toBe(
      true,
    );
    expect(access("/shared", "modify", null).allowed).toBe(true);
  });

  it("still confines everything outside /shared to its owner", () => {
    expect(access(`/${OTHER_OWNER}/notes.txt`, "read", OTHER_OWNER)).toEqual({
      allowed: false,
      code: "ACCESS_DENIED",
      message: "You do not have access to this resource",
    });
    expect(access(`/${user.id}/notes.txt`, "modify", user.id).allowed).toBe(
      true,
    );
  });

  it("does not match a path that merely starts with the same letters", () => {
    expect(
      access("/sharedother/notes.txt", "modify", OTHER_OWNER).allowed,
    ).toBe(false);
  });

  it("keeps superusers able to modify anything", () => {
    const superuser = { ...user, role: "superuser" } satisfies SafeUserRecord;
    expect(
      access(`/${OTHER_OWNER}/notes.txt`, "modify", OTHER_OWNER, superuser)
        .allowed,
    ).toBe(true);
  });

  it("does not open /shared to project API keys", () => {
    // Projects return before the shared rule is reached, so a key scoped to one
    // project cannot reach communal storage through this.
    const result = checkStorageAccess(
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
        scopes: ["storage:read", "storage:write"],
      },
      "/shared/notes.txt",
      "storage:write",
      null,
      "modify",
    );
    expect(result.allowed).toBe(false);
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
