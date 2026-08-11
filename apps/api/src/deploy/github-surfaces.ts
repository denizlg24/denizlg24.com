import type { Database } from "@repo/cloud-core";
import type {
  DeploymentRow,
  DeployTargetRow,
} from "@repo/cloud-core/db/schema";
import { deployments } from "@repo/cloud-core/db/schema";
import type { ChangeDecision, GithubAppClient } from "@repo/cloud-core/deploy";
import type { WebhookDeployIntent } from "@repo/schemas/cloud";
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

/**
 * How long a reported skip is remembered. The two events for one commit arrive
 * within seconds; anything later is a genuine re-push and deserves its own run.
 */
const SKIP_MEMORY_MS = 10 * 60 * 1_000;

function commentMarker(targetId: string): string {
  return `<!-- forge:target:${targetId} -->`;
}

/**
 * Why nothing was built. The distinction that matters to a reader is whether
 * the change missed the project's directory entirely or landed in a shared
 * package whose changed modules this project never imports — the second looks
 * like a bug until it is spelled out.
 */
function skipSummary(
  target: DeployTargetRow,
  decision: ChangeDecision,
): string {
  const root = target.rootDirectory ?? ".";
  return decision.reason === "unimported-files"
    ? [
        `No file that \`${root}\` imports changed in this push.`,
        "",
        "Every change landed in a package this project depends on, in modules it",
        "does not reach — resolved from the import graph of the last build.",
      ].join("\n")
    : `Nothing under \`${root}\`, or in any package it depends on, changed in this push.`;
}

/**
 * Everything this writes back to GitHub is decoration. A failure here logs and
 * returns — a deployment that is live and healthy must never be reported as
 * failed because a check run could not be patched, and GitHub being down is
 * not a reason to stop deploying.
 */
export class GithubSurfaces {
  /** `${targetId}:${sha}` → when it was reported. Bounded by `SKIP_MEMORY_MS`. */
  readonly #reportedSkips = new Map<string, number>();

  constructor(private readonly options: GithubSurfacesOptions) {}

  /** True the first time a skip is seen, false while it is still remembered. */
  #claimSkip(key: string): boolean {
    const now = Date.now();
    for (const [seen, at] of this.#reportedSkips) {
      if (now - at > SKIP_MEMORY_MS) this.#reportedSkips.delete(seen);
    }
    if (this.#reportedSkips.has(key)) return false;
    this.#reportedSkips.set(key, now);
    return true;
  }

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
   * The push touched nothing this target reads, so no deployment was created.
   *
   * A commit whose checks simply do not mention a project reads exactly like a
   * webhook that never arrived, which is why Vercel reports its skips too. This
   * writes a completed check run and nothing else: there is no deployment, so
   * there is no environment to create and no build log to link.
   */
  async onSkipped(
    target: DeployTargetRow,
    intent: WebhookDeployIntent,
    decision: ChangeDecision,
  ): Promise<void> {
    const repo = repoFor(target);
    if (!repo) return;
    // A push to a branch with an open pull request arrives twice, as `push` and
    // as `pull_request.synchronize`. A real deployment dedupes on the in-flight
    // row it already created; a skip creates nothing, so it dedupes here.
    if (!this.#claimSkip(`${target.id}:${intent.sha}`)) return;

    await this.#swallow("skipped check run create", async () => {
      await this.options.client.createCheckRun({
        ...repo,
        name: `forge / ${target.name}`,
        headSha: intent.sha,
        detailsUrl: `${this.options.adminBaseUrl.replace(/\/$/, "")}/deployments/${target.id}`,
        completed: {
          conclusion: "skipped",
          output: {
            title: "Skipped — no changes to this project",
            summary: skipSummary(target, decision),
          },
        },
      });
    });
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
