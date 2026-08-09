import { describe, expect, it } from "bun:test";

import type { DeploymentRow, DeployTargetRow } from "../db/schema";
import { toAgentRequest } from "./deployments";

describe("toAgentRequest", () => {
  it("uses the memory values frozen when the deployment was admitted", () => {
    const deployment = {
      id: crypto.randomUUID(),
      kind: "production",
      hostname: "app.denizlg24.com",
      gitRef: "main",
      gitSha: "0".repeat(40),
      buildSpec: { builder: "nixpacks" },
      memoryReservationMb: 256,
      memoryCeilingMb: 1_024,
    } as DeploymentRow;
    const target = {
      id: crypto.randomUUID(),
      repoOwner: "denizlg24",
      repoName: "app",
      healthPath: "/",
      // These were edited after enqueue and must not alter this run.
      memoryReservationMb: 2_048,
      memoryLimitMb: null,
      cpuLimit: "1.00",
    } as DeployTargetRow;

    const request = toAgentRequest({
      deployment,
      target,
      projectSlug: "app",
    });

    expect(request.runtime.memoryReservationMb).toBe(256);
    expect(request.runtime.memoryLimitMb).toBe(1_024);
  });
});
