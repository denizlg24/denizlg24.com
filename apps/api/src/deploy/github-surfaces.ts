import type { Database } from "@repo/cloud-core";
import type {
  DeploymentRow,
  DeployTargetRow,
} from "@repo/cloud-core/db/schema";
import { deployments, deployTargets } from "@repo/cloud-core/db/schema";
import type { ChangeDecision, GithubAppClient } from "@repo/cloud-core/deploy";
import type {
  DeploymentStatus,
  WebhookDeployIntent,
} from "@repo/schemas/cloud";
import { isTerminalDeploymentStatus } from "@repo/schemas/cloud";
import { eq, inArray } from "drizzle-orm";

export interface GithubSurfacesOptions {
  db: Database;
  client: GithubAppClient;
  /**
   * Where a check run's "Details" link points: the Forge dashboard, which is
   * the only surface that renders a deployment. Pointing this at the cloud
   * admin sent every link on every pull request to a host that has no route
   * for it, so they all landed on its home page.
   */
  forgeBaseUrl: string;
}

export interface Repo {
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
        `No file that \`${root}\` reads changed in this push.`,
        "",
        "Resolved from the import graph of the last build: every change landed",
        "in a module, package or directory this project never reaches.",
      ].join("\n")
    : `Nothing under \`${root}\`, or in any package it depends on, changed in this push.`;
}

/**
 * What the ✓/✗ beside the commit becomes.
 *
 * `superseded` is a skip, not a failure: a newer commit arrived and this build
 * stopped being the answer, which is nothing the reader has to act on. It is
 * also why the mapping has to exist at all — a check run left `in_progress`
 * spins on the commit for ever, and GitHub counts `skipped` as passing where a
 * run that never completes blocks a required-checks merge indefinitely.
 */
function checkConclusion(
  status: DeploymentStatus,
): "success" | "cancelled" | "skipped" | "failure" {
  switch (status) {
    case "ready":
      return "success";
    case "cancelled":
      return "cancelled";
    case "superseded":
      return "skipped";
    default:
      return "failure";
  }
}

/**
 * `inactive` is what retires a transient environment on GitHub's side, so a
 * superseded preview stops being listed as deployed rather than being reported
 * as a failure that never happened.
 */
function deploymentState(
  status: DeploymentStatus,
): "success" | "inactive" | "failure" {
  if (status === "ready") return "success";
  return status === "superseded" ? "inactive" : "failure";
}

function checkOutput(row: DeploymentRow): { title: string; summary: string } {
  if (row.status === "ready") {
    return {
      title: `Deployed in ${Math.round((row.buildDurationMs ?? 0) / 1_000)}s`,
      summary: `https://${row.hostname}`,
    };
  }
  if (row.status === "superseded") {
    return {
      title: "Superseded by a newer deployment",
      summary: row.error ?? "A newer deployment replaced this one.",
    };
  }
  return {
    title: `Deployment ${row.status}`,
    // The agent reports the failure text on the row; the full log lives on the
    // deploy host and is one click away in details_url.
    summary: row.error ?? "No error was reported",
  };
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

  #base(): string {
    return this.options.forgeBaseUrl.replace(/\/$/, "");
  }

  /** `/deployments/:id` — the deployment detail page, build log included. */
  #detailsUrl(row: DeploymentRow): string {
    return `${this.#base()}/deployments/${row.id}`;
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
    await this.#reportTerminal(row, repo);
    await this.#comment(row, target, repo);
  }

  /**
   * Rows that reached a terminal status without the agent reporting it: both
   * supersedes, the sweep that marks a dead build interrupted, and cancelling
   * one that was never claimed. They are the only finished deployments that do
   * not pass through `onFinished`, which is why every one of them used to leave
   * a check run spinning on the commit for good.
   *
   * No pull request comment. A row is superseded precisely because a newer one
   * exists, and that one writes the comment a moment later — writing here would
   * be an API call to publish text that is overwritten before anyone reads it.
   */
  async onRetired(rows: readonly DeploymentRow[]): Promise<void> {
    const reportable = rows.filter(
      (row) => row.githubCheckRunId !== null || row.githubDeploymentId !== null,
    );
    if (reportable.length === 0) return;
    const targetIds = [...new Set(reportable.map((row) => row.targetId))];
    const targets = await this.options.db
      .select()
      .from(deployTargets)
      .where(inArray(deployTargets.id, targetIds));
    const byId = new Map(targets.map((target) => [target.id, target]));

    for (const row of reportable) {
      const target = byId.get(row.targetId);
      if (!target) continue;
      const repo = repoFor(target);
      if (!repo) continue;
      await this.#reportTerminal(row, repo);
    }
  }

  /** The check run and the deployment status, for a run that is over. */
  async #reportTerminal(row: DeploymentRow, repo: Repo): Promise<void> {
    const detailsUrl = this.#detailsUrl(row);

    if (row.githubCheckRunId !== null) {
      const checkRunId = row.githubCheckRunId;
      await this.#swallow("check run update", async () => {
        await this.options.client.updateCheckRun({
          ...repo,
          checkRunId,
          update: {
            status: "completed",
            conclusion: checkConclusion(row.status),
            detailsUrl,
            output: checkOutput(row),
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
          state: deploymentState(row.status),
          ...(row.status === "ready"
            ? { environmentUrl: `https://${row.hostname}` }
            : {}),
          logUrl: detailsUrl,
        });
      });
    }
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
    projectSlug: string,
    intent: WebhookDeployIntent,
    decision: ChangeDecision,
  ): Promise<void> {
    const repo = repoFor(target);
    if (!repo) return;
    // Only `push` decides to skip, so one commit cannot reach here via two
    // event types. Two pushes landing on the same SHA still can — a re-push of
    // an unchanged tree, or a retried delivery.
    if (!this.#claimSkip(`${target.id}:${intent.sha}`)) return;

    await this.#swallow("skipped check run create", async () => {
      await this.options.client.createCheckRun({
        ...repo,
        name: `forge / ${target.name}`,
        headSha: intent.sha,
        // There is no deployment, so there is no detail page. The project's
        // deployment list is the nearest thing that exists.
        detailsUrl: `${this.#base()}/${encodeURIComponent(projectSlug)}/deployments`,
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
   * A pull request pointed at a commit. Nothing is built here — `push` already
   * decided that — so this reports what exists onto the pull request.
   *
   * The comment is the part that was missing entirely: a branch pushed before
   * its pull request was opened built under `prNumber: null`, and `#comment`
   * returns on a null number, so the deployment never announced itself. It is
   * also why the check run may need creating: the build has usually finished
   * by the time the pull request appears, and a run created now has to be born
   * completed rather than spinning for ever on a commit nothing will report on
   * again.
   */
  async onPullRequestAttached(
    row: DeploymentRow,
    target: DeployTargetRow,
  ): Promise<void> {
    const repo = repoFor(target);
    if (!repo) return;

    if (row.githubCheckRunId === null) {
      await this.#swallow("attached check run create", async () => {
        const checkRunId = await this.options.client.createCheckRun({
          ...repo,
          name: `forge / ${target.name}`,
          headSha: row.gitSha,
          detailsUrl: this.#detailsUrl(row),
          ...(isTerminalDeploymentStatus(row.status)
            ? {
                completed: {
                  conclusion: checkConclusion(row.status),
                  output: checkOutput(row),
                },
              }
            : {}),
        });
        await this.options.db
          .update(deployments)
          .set({ githubCheckRunId: checkRunId })
          .where(eq(deployments.id, row.id));
        row.githubCheckRunId = checkRunId;
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
   * The 👀 that says the comment was read, before there is anything to link at.
   * A command that has to resolve a pull request and several targets is seconds
   * of silence otherwise, which is indistinguishable from a dropped webhook.
   */
  async onCommandRead(repo: Repo, commentId: number): Promise<void> {
    await this.#swallow("command reaction", async () => {
      await this.options.client.reactToIssueComment({
        ...repo,
        commentId,
        content: "eyes",
      });
    });
  }

  /** 🚀 when the command produced deployments, 😕 when it produced none. */
  async onCommandSettled(
    repo: Repo,
    commentId: number,
    deployed: boolean,
  ): Promise<void> {
    await this.#swallow("command reaction", async () => {
      await this.options.client.reactToIssueComment({
        ...repo,
        commentId,
        content: deployed ? "rocket" : "confused",
      });
    });
  }

  /**
   * Why a command built nothing. A reaction alone cannot carry a reason, and
   * every case that reaches here — a fork, a closed pull request, a name that
   * matches no target — looks identical to a broken bot without one.
   *
   * Keyed on the comment that asked, so a redelivered webhook edits its own
   * reply instead of posting a second one.
   */
  async onCommandRefused(
    repo: Repo,
    input: { prNumber: number; commentId: number; reason: string },
  ): Promise<void> {
    const marker = `<!-- forge:command:${input.commentId} -->`;
    await this.#swallow("command refusal comment", async () => {
      await this.options.client.upsertIssueComment({
        ...repo,
        issueNumber: input.prNumber,
        marker,
        body: `${marker}\n${input.reason}`,
      });
    });
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
    // Every terminal status is named. The fallthrough is "building", so a
    // status this does not know about reads as a run still in progress —
    // the one thing a finished deployment must never say.
    const status =
      row.status === "ready"
        ? `✅ Ready · [${row.hostname}](https://${row.hostname})`
        : row.status === "failed"
          ? "❌ Failed"
          : row.status === "cancelled"
            ? "⚪ Cancelled"
            : row.status === "superseded"
              ? "⏭️ Superseded"
              : row.status === "interrupted"
                ? "❌ Interrupted"
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
