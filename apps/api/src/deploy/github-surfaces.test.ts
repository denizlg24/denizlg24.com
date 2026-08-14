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
  created: { detailsUrl: string; conclusion: unknown }[];
  states: unknown[];
  comments: { issueNumber: unknown; body: string }[];
  updated: Record<string, unknown>[];
  reactions: { commentId: unknown; content: unknown }[];
}

function surfaces(targets: DeployTargetRow[] = [TARGET]): {
  surfaces: GithubSurfaces;
  recorded: Recorded;
} {
  const recorded: Recorded = {
    checkRuns: [],
    created: [],
    states: [],
    comments: [],
    updated: [],
    reactions: [],
  };
  const client = {
    createCheckRun: async (input: {
      detailsUrl: string;
      completed?: { conclusion?: unknown };
    }) => {
      recorded.created.push({
        detailsUrl: input.detailsUrl,
        conclusion: input.completed?.conclusion ?? null,
      });
      return 101;
    },
    updateCheckRun: async (input: {
      update: { conclusion?: unknown; output?: { title?: unknown } };
    }) => {
      recorded.checkRuns.push({
        conclusion: input.update.conclusion,
        title: input.update.output?.title,
      });
    },
    createDeployment: async () => 11,
    createDeploymentStatus: async (input: { state: unknown }) => {
      recorded.states.push(input.state);
    },
    upsertIssueComment: async (input: {
      issueNumber: unknown;
      body: string;
    }) => {
      recorded.comments.push({
        issueNumber: input.issueNumber,
        body: input.body,
      });
    },
    reactToIssueComment: async (input: {
      commentId: unknown;
      content: unknown;
    }) => {
      recorded.reactions.push({
        commentId: input.commentId,
        content: input.content,
      });
    },
  } as unknown as GithubAppClient;
  const db = {
    select: () => ({ from: () => ({ where: async () => targets }) }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          recorded.updated.push(values);
        },
      }),
    }),
  } as unknown as Database;

  return {
    surfaces: new GithubSurfaces({
      db,
      client,
      forgeBaseUrl: "https://forge.denizlg24.com",
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

  it("links the deployment's own page, not the target's", async () => {
    const { surfaces: subject, recorded } = surfaces();
    const row = deployment("ready");
    row.prNumber = 12;

    await subject.onFinished(row, TARGET);

    expect(recorded.comments[0]?.body).toContain(
      `https://forge.denizlg24.com/deployments/${row.id}`,
    );
  });
});

describe("onPullRequestAttached", () => {
  it("comments for a build that finished before the pull request existed", async () => {
    const { surfaces: subject, recorded } = surfaces();
    const row = deployment("ready");
    row.prNumber = 31;

    await subject.onPullRequestAttached(row, TARGET);

    // The check run already exists on the commit from the push; only the
    // comment was missing.
    expect(recorded.created).toEqual([]);
    expect(recorded.comments).toEqual([
      { issueNumber: 31, body: expect.stringContaining("✅ Ready") },
    ]);
  });

  it("creates a missing check run already completed", async () => {
    const { surfaces: subject, recorded } = surfaces();
    const row = deployment("failed");
    row.githubCheckRunId = null;
    row.prNumber = 31;

    await subject.onPullRequestAttached(row, TARGET);

    expect(recorded.created).toEqual([
      {
        detailsUrl: `https://forge.denizlg24.com/deployments/${row.id}`,
        conclusion: "failure",
      },
    ]);
    expect(recorded.updated).toEqual([{ githubCheckRunId: 101 }]);
  });

  it("leaves a check run for an in-flight build open", async () => {
    const { surfaces: subject, recorded } = surfaces();
    const row = deployment("building");
    row.githubCheckRunId = null;
    row.prNumber = 31;

    await subject.onPullRequestAttached(row, TARGET);

    expect(recorded.created[0]?.conclusion).toBeNull();
  });

  it("writes nothing for a target with no installation", async () => {
    const { surfaces: subject, recorded } = surfaces();
    const row = deployment("ready");
    row.prNumber = 31;

    await subject.onPullRequestAttached(row, {
      ...TARGET,
      githubInstallationId: null,
    } as DeployTargetRow);

    expect(recorded.comments).toEqual([]);
    expect(recorded.created).toEqual([]);
  });
});

describe("comment commands", () => {
  const REPO = {
    installationId: 42,
    owner: "denizlg24",
    repo: "denizlg24.com",
  };

  it("acknowledges with 👀 and settles on what it produced", async () => {
    const { surfaces: subject, recorded } = surfaces();

    await subject.onCommandRead(REPO, 555);
    await subject.onCommandSettled(REPO, 555, true);
    await subject.onCommandSettled(REPO, 556, false);

    expect(recorded.reactions).toEqual([
      { commentId: 555, content: "eyes" },
      { commentId: 555, content: "rocket" },
      { commentId: 556, content: "confused" },
    ]);
  });

  it("keys a refusal on the comment that asked, so a redelivery edits it", async () => {
    const { surfaces: subject, recorded } = surfaces();

    await subject.onCommandRefused(REPO, {
      prNumber: 31,
      commentId: 555,
      reason: "`denizlg24/fork` is a fork.",
    });

    expect(recorded.comments).toEqual([
      {
        issueNumber: 31,
        body: "<!-- forge:command:555 -->\n`denizlg24/fork` is a fork.",
      },
    ]);
  });

  it("survives GitHub refusing the reaction", async () => {
    // Everything written back to GitHub is decoration; a 403 on a reaction must
    // not become a failed webhook and an unbuilt deployment.
    const subject = new GithubSurfaces({
      db: {} as unknown as Database,
      client: {
        reactToIssueComment: async () => {
          throw new Error("403");
        },
      } as unknown as GithubAppClient,
      forgeBaseUrl: "https://forge.denizlg24.com",
    });

    await expect(subject.onCommandRead(REPO, 555)).resolves.toBeUndefined();
  });
});
