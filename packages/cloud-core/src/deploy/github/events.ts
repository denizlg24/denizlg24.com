import type {
  GithubPullRequestEvent,
  GithubPushEvent,
  WebhookDeployIntent,
} from "@repo/schemas/cloud";

import { type BranchRoutingConfig, resolveBranchRoute } from "../environments";

/** What a target must look like for the decision; the row has far more on it. */
export interface WebhookTarget extends BranchRoutingConfig {
  autoDeploy: boolean;
}

export function branchFromRef(ref: string): string | null {
  return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : null;
}

const ZERO_SHA = /^0+$/;

/**
 * A push builds production, a custom environment, a preview, or nothing, and
 * which one is a property of the branch, the target's toggles and its branch
 * rules — `resolveBranchRoute` owns that whole decision. A tag push and a branch
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
  const route = resolveBranchRoute(branch, target);
  if (!route) return null;
  return {
    kind: route.kind,
    environmentId: route.environmentId,
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

const PULL_REQUEST_ATTACH_ACTIONS = new Set([
  "opened",
  "synchronize",
  "reopened",
  "ready_for_review",
]);

/** The commit a pull request event points at, and the number to report under. */
export interface PullRequestAttachment {
  ref: string;
  sha: string;
  prNumber: number;
}

/**
 * A pull request never queues a build. `push` is the only trigger.
 *
 * Both events fire for one commit on a same-repository branch, and deduping
 * them at the row was a check-then-insert with a GitHub comparison in the
 * middle — wide enough that two concurrently delivered webhooks both read no
 * existing row and both enqueued one. Having a single event build removes the
 * race rather than narrowing it.
 *
 * What the pull request is still needed for is reporting: the number, which a
 * push cannot know, and the commit to hang the check run and the comment on.
 * A fork PR produces no push here and so no longer builds at all, which is the
 * deliberate half of this — an untrusted branch stops getting a container with
 * this project's resource bindings in it.
 */
export function planPullRequestAttach(
  event: GithubPullRequestEvent,
): PullRequestAttachment | null {
  if (!PULL_REQUEST_ATTACH_ACTIONS.has(event.action)) return null;
  return {
    ref: event.pull_request.head.ref,
    sha: event.pull_request.head.sha,
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
 * A custom environment is not: like a preview it is a branch off production, so
 * the first push into `staging` compares against `main` rather than rebuilding
 * every target in the repository.
 */
export function comparisonBase(
  intent: Pick<WebhookDeployIntent, "kind" | "baseSha">,
  target: Pick<WebhookTarget, "productionBranch">,
): string | null {
  if (intent.baseSha !== null) return intent.baseSha;
  if (intent.kind === "production") return null;
  return target.productionBranch.length > 0 ? target.productionBranch : null;
}

export function isPullRequestTeardown(action: string): boolean {
  return action === "closed";
}

/** What a comment asked for. A null name means every target in the repository. */
export interface DeployCommand {
  targetName: string | null;
}

/**
 * `@app-slug deploy [target]` anywhere in a comment line.
 *
 * A verb is required, so talking *about* the bot never builds anything, and a
 * quoted line is skipped — a reply that quotes the command it is replying to is
 * otherwise a command itself, and a thread of them redeploys on every reply.
 * `[bot]` is optional because GitHub's own autocomplete inserts the bare slug
 * while the account it belongs to is `slug[bot]`.
 *
 * Everything after the verb is the target name rather than the first word of
 * one: a target name is a free string that may contain spaces, and the caller
 * matches what this returns against the names it has.
 */
export function parseDeployCommand(
  body: string | null | undefined,
  slug: string | null | undefined,
): DeployCommand | null {
  if (!body || !slug) return null;
  const wanted = slug.toLowerCase();
  const pattern = /@([a-z0-9][a-z0-9-]*)(?:\[bot\])?\s+([a-z]+)([^\n]*)/gi;
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (line.startsWith(">")) continue;
    pattern.lastIndex = 0;
    for (
      let match = pattern.exec(line);
      match !== null;
      match = pattern.exec(line)
    ) {
      const [, mentioned, verb, rest] = match;
      if (mentioned?.toLowerCase() !== wanted) continue;
      if (verb?.toLowerCase() !== "deploy") continue;
      const name = (rest ?? "").replace(/[`"']/g, "").trim();
      return { targetName: name.length > 0 ? name : null };
    }
  }
  return null;
}

/**
 * Only the repository owner. Forge is single-tenant, so this is the whole
 * authorization model: anyone else's comment is not refused, it is unread.
 */
export function canRunDeployCommand(
  authorAssociation: string | null | undefined,
): boolean {
  return authorAssociation === "OWNER";
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
