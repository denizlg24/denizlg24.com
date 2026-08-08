import type { Database } from "@repo/cloud-core";
import type {
  DeploymentRow,
  DeployTargetRow,
} from "@repo/cloud-core/db/schema";
import { deployments } from "@repo/cloud-core/db/schema";
import type { GithubAppClient } from "@repo/cloud-core/deploy";
import { eq } from "drizzle-orm";

export interface GithubSurfacesOptions {
  db: Database;
  client: GithubAppClient;
  /** Where a check run's "Details" link points. */
  adminBaseUrl: string;
}

interface Repo {
  installationId: number;
  owner: string;
  repo: string;
}

function repoFor(target: DeployTargetRow): Repo | null {
  if (target.githubInstallationId === null) return null;
  return {
    installationId: target.githubInstallationId,
    owner: target.repoOwner,
    repo: target.repoName,
  };
}

function commentMarker(targetId: string): string {
  return `<!-- forge:target:${targetId} -->`;
}

/**
 * Everything this writes back to GitHub is decoration. A failure here logs and
 * returns — a deployment that is live and healthy must never be reported as
 * failed because a check run could not be patched, and GitHub being down is
 * not a reason to stop deploying.
 */
export class GithubSurfaces {
  constructor(private readonly options: GithubSurfacesOptions) {}

  #detailsUrl(row: DeploymentRow): string {
    return `${this.options.adminBaseUrl.replace(/\/$/, "")}/deployments/${row.targetId}?d=${row.id}`;
  }

  async #swallow(what: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (error) {
      console.error(`[deploy] GitHub ${what} failed`, error);
    }
  }

  /**
   * Called once, as the row is enqueued. The check run and the deployment are
   * created together so the commit shows something within a second of the push
   * rather than when the build finishes.
   */
  async onEnqueued(row: DeploymentRow, target: DeployTargetRow): Promise<void> {
    const repo = repoFor(target);
    if (!repo) return;
    const detailsUrl = this.#detailsUrl(row);

    await this.#swallow("check run create", async () => {
      const checkRunId = await this.options.client.createCheckRun({
        ...repo,
        name: `forge / ${target.name}`,
        headSha: row.gitSha,
        detailsUrl,
      });
      await this.options.db
        .update(deployments)
        .set({ githubCheckRunId: checkRunId })
        .where(eq(deployments.id, row.id));
      row.githubCheckRunId = checkRunId;
    });

    await this.#swallow("deployment create", async () => {
      const deploymentId = await this.options.client.createDeployment({
        ...repo,
        sha: row.gitSha,
        environment:
          row.kind === "production" ? "Production" : `Preview – ${target.name}`,
        transient: row.kind === "preview",
        production: row.kind === "production",
        description: row.gitMessage?.split("\n")[0] ?? undefined,
      });
      await this.options.db
        .update(deployments)
        .set({ githubDeploymentId: deploymentId })
        .where(eq(deployments.id, row.id));
      row.githubDeploymentId = deploymentId;
      await this.options.client.createDeploymentStatus({
        ...repo,
        deploymentId,
        state: "in_progress",
        logUrl: detailsUrl,
      });
    });

    await this.#comment(row, target, repo);
  }

  /** Called on every terminal transition the agent reports. */
  async onFinished(row: DeploymentRow, target: DeployTargetRow): Promise<void> {
    const repo = repoFor(target);
    if (!repo) return;
    const detailsUrl = this.#detailsUrl(row);

    if (row.githubCheckRunId !== null) {
      const checkRunId = row.githubCheckRunId;
      await this.#swallow("check run update", async () => {
        await this.options.client.updateCheckRun({
          ...repo,
          checkRunId,
          update: {
            status: "completed",
            conclusion:
              row.status === "ready"
                ? "success"
                : row.status === "cancelled"
                  ? "cancelled"
                  : "failure",
            detailsUrl,
            output: {
              title:
                row.status === "ready"
                  ? `Deployed in ${Math.round((row.buildDurationMs ?? 0) / 1_000)}s`
                  : `Deployment ${row.status}`,
              // The agent reports the failure text on the row; the full log
              // lives on the deploy host and is one click away in details_url.
              summary:
                row.status === "ready"
                  ? `https://${row.hostname}`
                  : (row.error ?? "No error was reported"),
            },
          },
        });
      });
    }

    if (row.githubDeploymentId !== null) {
      const deploymentId = row.githubDeploymentId;
      await this.#swallow("deployment status", async () => {
        await this.options.client.createDeploymentStatus({
          ...repo,
          deploymentId,
          state: row.status === "ready" ? "success" : "failure",
          ...(row.status === "ready"
            ? { environmentUrl: `https://${row.hostname}` }
            : {}),
          logUrl: detailsUrl,
        });
      });
    }

    await this.#comment(row, target, repo);
  }

  /**
   * The PR closed. GitHub inactivates a transient environment on its own, but
   * only once it is told the deployment is inactive — and the containers and
   * DNS records on our side are reaped by the caller, not here.
   */
  async onPullRequestClosed(
    rows: readonly DeploymentRow[],
    target: DeployTargetRow,
  ): Promise<void> {
    const repo = repoFor(target);
    if (!repo) return;
    for (const row of rows) {
      if (row.githubDeploymentId === null) continue;
      const deploymentId = row.githubDeploymentId;
      await this.#swallow("deployment inactivate", async () => {
        await this.options.client.createDeploymentStatus({
          ...repo,
          deploymentId,
          state: "inactive",
        });
      });
    }
  }

  /**
   * One comment per target, edited in place on every transition. Only previews
   * built from a pull request have somewhere to put it.
   */
  async #comment(
    row: DeploymentRow,
    target: DeployTargetRow,
    repo: Repo,
  ): Promise<void> {
    if (row.prNumber === null) return;
    const prNumber = row.prNumber;
    const marker = commentMarker(target.id);
    const status =
      row.status === "ready"
        ? `✅ Ready · [${row.hostname}](https://${row.hostname})`
        : row.status === "failed"
          ? "❌ Failed"
          : row.status === "cancelled"
            ? "⚪ Cancelled"
            : "🔄 Building";
    const body = [
      marker,
      `**${target.name}**`,
      "",
      "| | |",
      "|---|---|",
      `| Status | ${status} |`,
      `| Commit | \`${row.gitSha.slice(0, 7)}\` |`,
      `| Updated | ${new Date().toISOString()} |`,
      "",
      `[Build log](${this.#detailsUrl(row)})`,
    ].join("\n");

    await this.#swallow("comment upsert", async () => {
      await this.options.client.upsertIssueComment({
        ...repo,
        issueNumber: prNumber,
        marker,
        body,
      });
    });
  }
}
