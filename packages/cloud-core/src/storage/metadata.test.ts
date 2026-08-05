import { describe, expect, it } from "bun:test";

import {
  METADATA_SCHEMA_VERSION,
  PROTECTED_XATTR_KEYS,
  PROTECTED_XATTR_NAMESPACE,
  protectedCanonicalForm,
  protectedMetadataHash,
} from "./metadata";

const ownerId = "30000000-0000-4000-8000-000000000003";
const fileId = "50000000-0000-4000-8000-000000000006";
const checksum = "b".repeat(64);

const file = {
  checksum,
  createdAt: "2026-07-02T10:00:00Z",
  id: fileId,
  mimeType: "text/plain",
  ownerId,
} as const;

const sharedRoot = {
  createdAt: "2026-07-01T10:00:00Z",
  id: "40000000-0000-4000-8000-000000000004",
  ownerId: null,
} as const;

describe("protected entry metadata", () => {
  it("emits every present key as key=value, ordered by suffix", () => {
    expect(protectedCanonicalForm(file, "file")).toBe(
      [
        `${PROTECTED_XATTR_KEYS.checksum}=${checksum}`,
        `${PROTECTED_XATTR_KEYS.checksumState}=verified`,
        `${PROTECTED_XATTR_KEYS.createdAt}=2026-07-02T10:00:00Z`,
        `${PROTECTED_XATTR_KEYS.id}=${fileId}`,
        `${PROTECTED_XATTR_KEYS.mimeType}=text/plain`,
        `${PROTECTED_XATTR_KEYS.ownerId}=${ownerId}`,
        `${PROTECTED_XATTR_KEYS.schemaVersion}=${METADATA_SCHEMA_VERSION}`,
        "",
      ].join("\n"),
    );
  });

  it("gives the shared root a scope instead of an owner", () => {
    const canonical = protectedCanonicalForm(sharedRoot, "folder");
    expect(canonical).toContain(`${PROTECTED_XATTR_KEYS.scope}=shared`);
    expect(canonical).not.toContain(PROTECTED_XATTR_KEYS.ownerId);
  });

  it("omits file-only keys from a folder", () => {
    const canonical = protectedCanonicalForm(
      { ...sharedRoot, ownerId },
      "folder",
    );
    expect(canonical).not.toContain(PROTECTED_XATTR_KEYS.checksum);
    expect(canonical).not.toContain(PROTECTED_XATTR_KEYS.mimeType);
  });

  it("refuses a file with no checksum rather than hashing a partial identity", () => {
    expect(() =>
      protectedCanonicalForm({ ...file, checksum: undefined }, "file"),
    ).toThrow("no checksum");
  });

  it("changes the hash when any protected value changes", () => {
    const base = protectedMetadataHash(file, "file");
    expect(
      protectedMetadataHash({ ...file, checksum: "c".repeat(64) }, "file"),
    ).not.toBe(base);
    expect(
      protectedMetadataHash({ ...file, mimeType: "application/pdf" }, "file"),
    ).not.toBe(base);
    expect(
      protectedMetadataHash({ ...file, checksumState: "pending" }, "file"),
    ).not.toBe(base);
  });

  it("normalises checksum case so one blob has one hash", () => {
    expect(
      protectedMetadataHash(
        { ...file, checksum: checksum.toUpperCase() },
        "file",
      ),
    ).toBe(protectedMetadataHash(file, "file"));
  });

  it("derives every key from the one namespace constant", () => {
    for (const key of Object.values(PROTECTED_XATTR_KEYS)) {
      expect(key.startsWith(`${PROTECTED_XATTR_NAMESPACE}denizcloud.`)).toBe(
        true,
      );
    }
  });
});
