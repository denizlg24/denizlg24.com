import { describe, expect, it } from "bun:test";

import {
  type CloudflareDnsRecord,
  parseForgeRecordComment,
} from "./cloudflare-dns";
import {
  type DeploymentDnsCandidate,
  type ForgeKeepCandidate,
  planDeploymentDnsCleanup,
  planForgeDnsReconciliation,
  selectForgeKeepSet,
} from "./gc";

function candidate(
  overrides: Partial<ForgeKeepCandidate> & { id: string },
): ForgeKeepCandidate {
  return {
    targetId: "target-a",
    status: "superseded",
    imageTag: `forge/app:${overrides.id}`,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    ...overrides,
  };
}

function record(
  overrides: Partial<CloudflareDnsRecord> & { id: string },
): CloudflareDnsRecord {
  return {
    name: `${overrides.id}.denizlg24.com`,
    type: "CNAME",
    content: "tunnel.cfargotunnel.com",
    proxied: true,
    comment: null,
    ...overrides,
  };
}

describe("parseForgeRecordComment", () => {
  it("reads both subject kinds", () => {
    expect(parseForgeRecordComment("forge deployment abc")).toEqual({
      kind: "deployment",
      id: "abc",
    });
    expect(parseForgeRecordComment("forge domain xyz")).toEqual({
      kind: "domain",
      id: "xyz",
    });
  });

  it("refuses anything it does not fully understand", () => {
    // A record this cannot read is one a newer writer created, and deleting
    // what you failed to parse is the worst possible reconciler behaviour.
    expect(parseForgeRecordComment(null)).toBeNull();
    expect(parseForgeRecordComment("cloud panel")).toBeNull();
    expect(parseForgeRecordComment("forge deployment")).toBeNull();
    expect(parseForgeRecordComment("forge widget abc")).toBeNull();
    expect(parseForgeRecordComment("forge deployment abc extra")).toBeNull();
  });
});

describe("selectForgeKeepSet", () => {
  it("keeps every live deployment, in flight or ready", () => {
    const keep = selectForgeKeepSet(
      [
        candidate({ id: "queued", status: "queued" }),
        candidate({ id: "building", status: "building" }),
        candidate({ id: "deploying", status: "deploying" }),
        candidate({ id: "ready", status: "ready" }),
        candidate({ id: "failed", status: "failed" }),
        candidate({ id: "superseded", status: "superseded" }),
      ],
      0,
    );
    expect(keep.keepDeploymentIds.sort()).toEqual([
      "building",
      "deploying",
      "queued",
      "ready",
    ]);
    // A live deployment's image is kept whatever the retention count says.
    expect(keep.keepImageTags).toContain("forge/app:ready");
    expect(keep.keepImageTags).not.toContain("forge/app:failed");
  });

  it("keeps the newest N images per target, counted separately", () => {
    const rows = [
      candidate({
        id: "a1",
        targetId: "a",
        createdAt: new Date("2026-08-01T00:00:00Z"),
      }),
      candidate({
        id: "a2",
        targetId: "a",
        createdAt: new Date("2026-08-02T00:00:00Z"),
      }),
      candidate({
        id: "a3",
        targetId: "a",
        createdAt: new Date("2026-08-03T00:00:00Z"),
      }),
      candidate({
        id: "b1",
        targetId: "b",
        createdAt: new Date("2026-07-01T00:00:00Z"),
      }),
    ];
    const keep = selectForgeKeepSet(rows, 2);
    expect(keep.keepImageTags.sort()).toEqual([
      "forge/app:a2",
      "forge/app:a3",
      "forge/app:b1",
    ]);
    expect(keep.keepDeploymentIds).toEqual([]);
  });

  // The shipped default. Every retained image is a full layer set on a disk with
  // none to spare, and it shows in the images list as something with no container
  // that reads as garbage.
  it("keeps only the newest build per target at the default retention of one", () => {
    const keep = selectForgeKeepSet(
      [
        candidate({
          id: "old",
          targetId: "a",
          createdAt: new Date("2026-08-01T00:00:00Z"),
        }),
        candidate({
          id: "newest",
          targetId: "a",
          createdAt: new Date("2026-08-03T00:00:00Z"),
        }),
        candidate({
          id: "live",
          targetId: "a",
          status: "ready",
          createdAt: new Date("2026-07-01T00:00:00Z"),
        }),
      ],
      1,
    );
    // The live deployment's image survives on its own account, and does not
    // consume the retention slot — otherwise a retention of one would keep only
    // what is already running and nothing would be warm for a rollback.
    expect(keep.keepImageTags.sort()).toEqual([
      "forge/app:live",
      "forge/app:newest",
    ]);
    expect(keep.keepImageTags).not.toContain("forge/app:old");
  });

  it("does not let a live image consume the retention slot", () => {
    const keep = selectForgeKeepSet(
      [
        candidate({
          id: "live",
          targetId: "a",
          status: "ready",
          createdAt: new Date("2026-08-03T00:00:00Z"),
        }),
        candidate({
          id: "previous",
          targetId: "a",
          createdAt: new Date("2026-08-02T00:00:00Z"),
        }),
        candidate({
          id: "older",
          targetId: "a",
          createdAt: new Date("2026-08-01T00:00:00Z"),
        }),
      ],
      1,
    );
    // The newest row is the live one. Its tag is protected already, so the single
    // retention slot has to go to the build behind it.
    expect(keep.keepImageTags.sort()).toEqual([
      "forge/app:live",
      "forge/app:previous",
    ]);
    expect(keep.keepImageTags).not.toContain("forge/app:older");
  });

  it("ignores insertion order when ranking a target's builds", () => {
    const keep = selectForgeKeepSet(
      [
        candidate({ id: "old", createdAt: new Date("2026-01-01T00:00:00Z") }),
        candidate({ id: "new", createdAt: new Date("2026-08-01T00:00:00Z") }),
      ],
      1,
    );
    expect(keep.keepImageTags).toEqual(["forge/app:new"]);
  });

  it("skips deployments that never produced an image", () => {
    const keep = selectForgeKeepSet(
      [candidate({ id: "none", imageTag: null, status: "failed" })],
      3,
    );
    expect(keep.keepImageTags).toEqual([]);
  });
});

describe("planDeploymentDnsCleanup", () => {
  function deployment(
    overrides: Partial<DeploymentDnsCandidate> & { id: string },
  ): DeploymentDnsCandidate {
    return {
      targetId: "target-a",
      hostname: `${overrides.id}.denizlg24.com`,
      kind: "production",
      status: "ready",
      dnsRecordId: `record-${overrides.id}`,
      ...overrides,
    };
  }

  it("removes terminal records and production records replaced by stable domains", () => {
    const candidates = planDeploymentDnsCleanup(
      [
        deployment({ id: "production" }),
        deployment({ id: "preview", kind: "preview" }),
        deployment({ id: "superseded", status: "superseded" }),
      ],
      new Set(["target-a"]),
    );

    expect(candidates.map((row) => row.id)).toEqual([
      "production",
      "superseded",
    ]);
  });

  it("keeps the production record until a stable domain is active", () => {
    expect(
      planDeploymentDnsCleanup([deployment({ id: "production" })], new Set()),
    ).toEqual([]);
  });
});

describe("planForgeDnsReconciliation", () => {
  const known = {
    deploymentIds: new Set(["live"]),
    domainIds: new Set(["kept"]),
  };

  it("removes only managed records whose row is gone", () => {
    const removed = planForgeDnsReconciliation(
      [
        record({ id: "1", comment: "forge deployment live" }),
        record({ id: "2", comment: "forge deployment vanished" }),
        record({ id: "3", comment: "forge domain kept" }),
        record({ id: "4", comment: "forge domain vanished" }),
      ],
      known,
    );
    expect(removed.map((r) => r.id)).toEqual(["2", "4"]);
  });

  it("never touches a record it did not create", () => {
    const removed = planForgeDnsReconciliation(
      [
        record({ id: "1", comment: null }),
        record({ id: "2", comment: "the admin panel" }),
        record({ id: "3", comment: "forge something-else vanished" }),
      ],
      known,
    );
    expect(removed).toEqual([]);
  });

  it("does not cross the two id namespaces", () => {
    // A domain id that happens to match a deployment id must not save the
    // record — they are different tables and uuids collide only by accident.
    const removed = planForgeDnsReconciliation(
      [record({ id: "1", comment: "forge domain live" })],
      known,
    );
    expect(removed.map((r) => r.id)).toEqual(["1"]);
  });
});
