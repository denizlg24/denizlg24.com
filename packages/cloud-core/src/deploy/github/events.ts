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
    // A created or rewritten ref has no meaningful previous tree. Null says so
    // rather than naming a commit the diff would be nonsense against; a preview
    // still gets compared to the production branch by the caller, and only a
    // production build with no base falls back to building unconditionally.
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

/**
 * What a change comparison for this deployment runs against, or null when there
 * is nothing meaningful on the other side of it.
 *
 * `baseSha` is null for a created or rewritten ref, and reading that as "build
 * everything" is what made the first push of every branch rebuild every target
 * in the repository. It says the *previous tree* is unusable, which is not the
 * same as having nothing to compare to: a preview changes whatever it changes
 * relative to production, and that is the base the `pull_request` event for the
 * same commit compares against seconds later anyway. Disagreeing with it is how
 * a build ended up running under a check run that said it had been skipped.
 *
 * A production build with no previous tree is the case that really is baseless.
 */
export function comparisonBase(
  intent: Pick<WebhookDeployIntent, "kind" | "baseSha">,
  target: Pick<WebhookTarget, "productionBranch">,
): string | null {
  if (intent.baseSha !== null) return intent.baseSha;
  if (intent.kind !== "preview") return null;
  return target.productionBranch.length > 0 ? target.productionBranch : null;
}

export function isPullRequestTeardown(action: string): boolean {
  return action === "closed";
}

/**
 * The branch a push destroyed, or null for an ordinary push.
 *
 * Deleting a branch is the other half of "the PR was merged" — GitHub's
 * auto-delete fires right after the merge — and it is the only signal for a
 * branch that never had a pull request at all. It arrives here rather than
 * through the `delete` event because a branch deletion is *also* delivered as a
 * push, so this needs no change to what the App subscribes to. `planPushDeployment`
 * already discards these; this is what reads them instead of dropping them.
 */
export function planBranchTeardown(event: GithubPushEvent): string | null {
  if (!event.deleted) return null;
  return branchFromRef(event.ref);
}
