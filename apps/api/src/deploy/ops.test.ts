import { describe, expect, it } from "bun:test";
import type { DeploymentRow } from "@repo/cloud-core/db/schema";

import { forgeRecoveryPublishSummary } from "../ops/executors";
import {
  hasImmutableRecoveryImage,
  recordedRecoveryBuilder,
  recoveryPublishCandidates,
} from "./ops";

const NOW = Date.parse("2026-09-23T12:00:00Z");
const DIGEST = `sha256:${"a".repeat(64)}`;

function deployment(overrides: Partial<DeploymentRow> = {}): DeploymentRow {
  return {
    id: crypto.randomUUID(),
    kind: "production",
    status: "ready",
    phase: null,
    imageTag: "forge/app:abc1234-0000",
    imageDigest: null,
    resolvedBuilder: "dockerfile",
    buildSpec: null,
    heartbeatAt: new Date(NOW - 60 * 60_000),
    createdAt: new Date(NOW - 2 * 60 * 60_000),
    ...overrides,
  } as DeploymentRow;
}

describe("recovery image selection", () => {
  it("recognises a digest-pinned reference as published", () => {
    expect(
      hasImmutableRecoveryImage(
        deployment({
          imageTag: `ghcr.io/denizlg24/forge-recovery/app@${DIGEST}`,
          imageDigest: DIGEST,
        }),
      ),
    ).toBe(true);
    expect(hasImmutableRecoveryImage(deployment())).toBe(false);
  });

  it("selects unpublished rows oldest first", () => {
    const newer = deployment({ createdAt: new Date(NOW - 10 * 60_000) });
    const older = deployment({ createdAt: new Date(NOW - 50 * 60_000) });
    const published = deployment({
      imageTag: `ghcr.io/denizlg24/forge-recovery/app@${DIGEST}`,
      imageDigest: DIGEST,
    });

    expect(
      recoveryPublishCandidates([newer, published, older], NOW).map(
        (row) => row.id,
      ),
    ).toEqual([older.id, newer.id]);
  });

  it("leaves a push the pipeline is still running to the pipeline", () => {
    const pushing = deployment({
      phase: "backing-up",
      heartbeatAt: new Date(NOW - 60_000),
    });
    const abandoned = deployment({
      phase: "backing-up",
      heartbeatAt: new Date(NOW - 60 * 60_000),
    });

    expect(
      recoveryPublishCandidates([pushing, abandoned], NOW).map((row) => row.id),
    ).toEqual([abandoned.id]);
  });

  it("falls back to the build spec for the builder, and to nothing", () => {
    expect(
      recordedRecoveryBuilder(
        deployment({
          resolvedBuilder: null,
          buildSpec: { builder: "nixpacks" } as DeploymentRow["buildSpec"],
        }),
      ),
    ).toBe("nixpacks");
    expect(
      recordedRecoveryBuilder(deployment({ resolvedBuilder: null })),
    ).toBeNull();
  });
});

describe("forgeRecoveryPublishSummary", () => {
  it("names each deployment that failed", () => {
    const id = crypto.randomUUID();
    expect(
      forgeRecoveryPublishSummary({
        pending: 3,
        published: [
          {
            deploymentId: crypto.randomUUID(),
            reference: `ghcr.io/denizlg24/forge-recovery/app@${DIGEST}`,
          },
        ],
        deferred: 1,
        failures: [
          {
            step: "publish",
            subject: id,
            error: "push recovery image timed out",
          },
        ],
      }),
    ).toBe(
      `Recovery images: 1 published of 3 missing\n1 left for the next run\n${id}: push recovery image timed out`,
    );
  });
});
