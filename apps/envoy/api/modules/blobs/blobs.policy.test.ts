import { describe, expect, test } from "bun:test";
import { authorizeBlobPolicyUpdate, canDownloadBlob } from "./blobs.policy";

describe("authorizeBlobPolicyUpdate", () => {
  test("rejects non-members", () => {
    expect(
      authorizeBlobPolicyUpdate({
        requesterRole: null,
        hasExistingPolicy: false,
        memberIds: null,
      }).allowed
    ).toBeFalse();
  });

  test("lets members preserve unrestricted access for a new blob", () => {
    expect(
      authorizeBlobPolicyUpdate({
        requesterRole: "user",
        hasExistingPolicy: false,
        memberIds: null,
      })
    ).toEqual({ allowed: true });
  });

  test("prevents members from removing an existing restriction", () => {
    const decision = authorizeBlobPolicyUpdate({
      requesterRole: "user",
      hasExistingPolicy: true,
      memberIds: null,
    });

    expect(decision.allowed).toBeFalse();
  });

  test("only lets owners create or replace grants", () => {
    expect(
      authorizeBlobPolicyUpdate({
        requesterRole: "user",
        hasExistingPolicy: false,
        memberIds: ["member-id"],
      }).allowed
    ).toBeFalse();
    expect(
      authorizeBlobPolicyUpdate({
        requesterRole: "owner",
        hasExistingPolicy: false,
        memberIds: [],
      })
    ).toEqual({ allowed: true });
  });
});

describe("canDownloadBlob", () => {
  test("preserves project-wide access when no policy exists", () => {
    expect(
      canDownloadBlob({
        isOwner: false,
        hasPolicy: false,
        hasGrant: false,
      })
    ).toBeTrue();
  });

  test("allows owners and explicitly granted members", () => {
    expect(
      canDownloadBlob({
        isOwner: true,
        hasPolicy: true,
        hasGrant: false,
      })
    ).toBeTrue();
    expect(
      canDownloadBlob({
        isOwner: false,
        hasPolicy: true,
        hasGrant: true,
      })
    ).toBeTrue();
  });

  test("denies ungranted members when a policy exists", () => {
    expect(
      canDownloadBlob({
        isOwner: false,
        hasPolicy: true,
        hasGrant: false,
      })
    ).toBeFalse();
  });
});
