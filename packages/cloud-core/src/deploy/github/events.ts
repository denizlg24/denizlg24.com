import type {
  GithubPullRequestEvent,
  GithubPushEvent,
  WebhookDeployIntent,
} from "@repo/schemas/cloud";

/** What a target must look like for the decision; the row has far more on it. */
export interface WebhookTarget {
  productionBranch: string;
  autoDeploy: boolean;
  previewDeploys: boolean;
}

export function branchFromRef(ref: string): string | null {
  return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : null;
}

const ZERO_SHA = /^0+$/;

/**
 * A push either builds production or a preview or nothing, and which one is a
 * property of the branch and the target's two toggles. A tag push and a branch
 * deletion both arrive here as pushes and neither is a deployment.
 */
export function planPushDeployment(
  event: GithubPushEvent,
  target: WebhookTarget,
): WebhookDeployIntent | null {
  if (event.deleted) return null;
  const branch = branchFromRef(event.ref);
  if (!branch) return null;
  if (!target.autoDeploy) return null;
  const production = branch === target.productionBranch;
  if (!production && !target.previewDeploys) return null;
  return {
    kind: production ? "production" : "preview",
    ref: branch,
    // A created ref has no meaningful previous tree. Building is the safe
    // answer even if GitHub sends a zero SHA in `before` as expected.
    baseSha:
      event.created || event.forced || ZERO_SHA.test(event.before)
        ? null
        : event.before,
    sha: event.after,
    message: event.head_commit?.message ?? null,
    prNumber: null,
  };
}

const PULL_REQUEST_BUILD_ACTIONS = new Set([
  "opened",
  "synchronize",
  "reopened",
  "ready_for_review",
]);

/**
 * A pull request from the same repository has already produced a push event for
 * its head branch, so building on both would double every preview. This exists
 * for the pull-request number — it is what lets a preview be torn down when the
 * PR closes and tells the comment where to go — and the caller dedupes on the
 * SHA, which both events agree on.
 */
export function planPullRequestDeployment(
  event: GithubPullRequestEvent,
  target: WebhookTarget,
): WebhookDeployIntent | null {
  if (!PULL_REQUEST_BUILD_ACTIONS.has(event.action)) return null;
  if (!target.autoDeploy || !target.previewDeploys) return null;
  // A draft is not ready for review and not worth a container; the
  // `ready_for_review` action is what brings it back.
  if (event.pull_request.draft && event.action !== "ready_for_review") {
    return null;
  }
  return {
    kind: "preview",
    ref: event.pull_request.head.ref,
    baseSha:
      event.action === "synchronize" &&
      event.before &&
      event.after === event.pull_request.head.sha
        ? event.before
        : event.pull_request.base.sha,
    sha: event.pull_request.head.sha,
    message: event.pull_request.title ?? null,
    prNumber: event.number,
  };
}

export function isPullRequestTeardown(action: string): boolean {
  return action === "closed";
}
