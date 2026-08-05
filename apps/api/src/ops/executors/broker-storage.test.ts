import { describe, expect, it } from "bun:test";

import { assertApiFilesBackupAllowed } from ".";

describe("broker-mounted ops safety", () => {
  it("keeps the legacy API files backup available", () => {
    expect(() =>
      assertApiFilesBackupAllowed({
        namespace: { mode: "legacy-dual-path", rootPath: null },
      }),
    ).not.toThrow();
  });

  it("requires the privileged host backup in broker mode", () => {
    expect(() =>
      assertApiFilesBackupAllowed({
        namespace: {
          mode: "broker-mounted",
          rootPath: "/data/storage",
          witnessPath: "/data/storage/.denizcloud-mount-witness",
          witnessValue: "test-witness-value",
        },
      }),
    ).toThrow("privileged host namespace backup");
  });
});
