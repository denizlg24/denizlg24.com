import { describe, expect, it } from "bun:test";

import type { Database } from "@repo/cloud-core";
import type {
  DeploymentRow,
  DeployTargetRow,
} from "@repo/cloud-core/db/schema";
import type { GithubAppClient } from "@repo/cloud-core/deploy";
import type { DeploymentStatus } from "@repo/schemas/cloud";

import { GithubSurfaces } from "./github-surfaces";

const TARGET = {
  id: crypto.randomUUID(),
  name: "api",
  githubInstallationId: 42,
  repoOwner: "denizlg24",
  repoName: "denizlg24.com",
  rootDirectory: "apps/api",
} as DeployTargetRow;

function deployment(status: DeploymentStatus): DeploymentRow {
  return {
    id: crypto.randomUUID(),
    targetId: TARGET.id,
    kind: "preview",
    status,
    gitSha: "0".repeat(40),
    hostname: "api-abc.denizlg24.com",
    prNumber: null,
    error: null,
    buildDurationMs: 12_000,
    githubCheckRunId: 7,
    githubDeploymentId: 9,
  } as DeploymentRow;
}

interface Recorded {
  checkRuns: { conclusion: unknown; title: unknown }[];
  states: unknown[];
}

function surfaces(targets: DeployTargetRow[] = [TARGET]): {
  surfaces: GithubSurfaces;
  recorded: Recorded;
} {
  const recorded: Recorded = { checkRuns: [], states: [] };
  const client = {
    updateCheckRun: async (input: {
      update: { conclusion?: unknown; output?: { title?: unknown } };
    }) => {
      recorded.checkRuns.push({
        conclusion: input.update.conclusion,
        title: input.update.output?.title,
      });
    },
    createDeploymentStatus: async (input: { state: unknown }) => {
      recorded.states.push(input.state);
    },
    upsertIssueComment: async () => {},
  } as unknown as GithubAppClient;
  const db = {
    select: () => ({ from: () => ({ where: async () => targets }) }),
  } as unknown as Database;

  return {
    surfaces: new GithubSurfaces({
      db,
      client,
      adminBaseUrl: "https://forge.denizlg24.com",
    }),
    recorded,
  };
}

describe("onRetired", () => {
  it("reports a superseded deployment as skipped, not failed", async () => {
    const { surfaces: subject, recorded } = surfaces();

    await subject.onRetired([deployment("superseded")]);

    expect(recorded.checkRuns).toEqual([
      {
        conclusion: "skipped",
        title: "Superseded by a newer deployment",
      },
    ]);
    // The environment is retired rather than reported as a failure that never
    // happened.
    expect(recorded.states).toEqual(["inactive"]);
  });

  it("reports an interrupted deployment as a failure", async () => {
    const { surfaces: subject, recorded } = surfaces();

    await subject.onRetired([deployment("interrupted")]);

    expect(recorded.checkRuns[0]?.conclusion).toBe("failure");
    expect(recorded.states).toEqual(["failure"]);
  });

  it("writes nothing for a row that never got a check run", async () => {
    const { surfaces: subject, recorded } = surfaces();
    const row = { ...deployment("superseded") };
    row.githubCheckRunId = null;
    row.githubDeploymentId = null;

    await subject.onRetired([row]);

    expect(recorded.checkRuns).toEqual([]);
    expect(recorded.states).toEqual([]);
  });

  it("skips a row whose target has no installation", async () => {
    const { surfaces: subject, recorded } = surfaces([
      { ...TARGET, githubInstallationId: null } as DeployTargetRow,
    ]);

    await subject.onRetired([deployment("superseded")]);

    expect(recorded.checkRuns).toEqual([]);
  });
});

describe("onFinished", () => {
  it("still reports a ready deployment as a success", async () => {
    const { surfaces: subject, recorded } = surfaces();

    await subject.onFinished(deployment("ready"), TARGET);

    expect(recorded.checkRuns).toEqual([
      { conclusion: "success", title: "Deployed in 12s" },
    ]);
    expect(recorded.states).toEqual(["success"]);
  });
});
