import {
  type AgentDeploymentRequest,
  type DeploymentBuildSpec,
  type DeploymentKind,
  type DeploymentStatus,
  type DeploymentStatusUpdate,
  isDeployNodeVersion,
  isTerminalDeploymentStatus,
} from "@repo/schemas/cloud";
import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";

import type { Database } from "../db";
import {
  type DeploymentRow,
  type DeployTargetRow,
  deployments,
} from "../db/schema";

/**
 * `FOR UPDATE SKIP LOCKED` on the control plane rather than a lock the agent
 * holds: the row is flipped to `building` in the same statement that claims
 * it, so a crash between the claim and the first status report leaves a row
 * the interrupted sweep reclaims — not one two agents both build.
 *
 * One deployment per target at a time, which only started mattering when the
 * agent gained more than one build slot. Three things in the pipeline are keyed
 * by target or project rather than by deployment, and all three break if two
 * runs for the same target overlap: `reapSuperseded` stops every production
 * container for the target except its own, so whichever finishes last wins
 * regardless of which is newer; both builds move `forge/<slug>:latest`, leaving
 * the loser's image untagged the moment it is written; and the BuildKit cache
 * mounts are `id=<targetId>-…`, so the two contend for the same store.
 *
 * Different targets still run in parallel, which is the case the extra slots
 * exist for — a monorepo push queues one deployment per project.
 */
export async function claimQueuedDeployment(
  db: Database,
): Promise<DeploymentRow | null> {
  const claimed = await db.execute(sql<{ id: string }>`
    WITH claimed AS (
      SELECT queued.id FROM ${deployments} AS queued
      WHERE queued.status = 'queued'
        AND NOT EXISTS (
          SELECT 1 FROM ${deployments} AS active
          WHERE active.target_id = queued.target_id
            AND active.status IN ('building', 'deploying')
        )
      ORDER BY queued.created_at
      FOR UPDATE OF queued SKIP LOCKED
      LIMIT 1
    )
    UPDATE ${deployments}
    SET status = 'building',
        phase = 'cloning',
        started_at = now(),
        heartbeat_at = now()
    FROM claimed
    WHERE ${deployments.id} = claimed.id
    RETURNING ${deployments.id}
  `);
  // `execute` hands back untyped driver rows; the RETURNING clause above is
  // what makes this shape true.
  const [claimedRow] = Array.from(claimed) as { id: string }[];
  const id = claimedRow?.id;
  if (!id) return null;
  const [row] = await db
    .select()
    .from(deployments)
    .where(eq(deployments.id, id));
  return row ?? null;
}

/**
 * The build spec a target's own columns describe, with no preset resolved into
 * it. Used only for deployments queued before the spec was frozen on the row —
 * every new one carries what the resolver produced at enqueue.
 */
export function buildSpecFromTarget(
  target: DeployTargetRow,
): DeploymentBuildSpec {
  return {
    builder: target.builder,
    ...(target.rootDirectory ? { rootDirectory: target.rootDirectory } : {}),
    ...(target.dockerfilePath ? { dockerfilePath: target.dockerfilePath } : {}),
    ...(target.installCommand ? { installCommand: target.installCommand } : {}),
    ...(target.buildCommand ? { buildCommand: target.buildCommand } : {}),
    ...(target.startCommand ? { startCommand: target.startCommand } : {}),
    ...(isDeployNodeVersion(target.nodeVersion)
      ? { nodeVersion: target.nodeVersion }
      : {}),
  };
}

export function toAgentRequest(input: {
  deployment: DeploymentRow;
  target: DeployTargetRow;
  projectSlug: string;
}): AgentDeploymentRequest {
  const { deployment, target } = input;
  return {
    deploymentId: deployment.id,
    targetId: target.id,
    projectSlug: input.projectSlug,
    kind: deployment.kind,
    hostname: deployment.hostname,
    repository: {
      owner: target.repoOwner,
      name: target.repoName,
      ref: deployment.gitRef,
      sha: deployment.gitSha,
    },
    // What the row was queued with, not what the target says now: editing a
    // target must not change a build that is already in the queue.
    build: deployment.buildSpec ?? buildSpecFromTarget(target),
    runtime: {
      healthPath: target.healthPath,
      // Frozen on the deployment at enqueue. Target settings edited while the
      // row waits in the queue cannot change what was admitted.
      memoryLimitMb: deployment.memoryCeilingMb,
      memoryReservationMb: deployment.memoryReservationMb,
      cpuLimit: Number(target.cpuLimit),
    },
    timeouts: { healthMs: 90_000 },
  };
}

/**
 * Every status write refreshes `heartbeatAt`, which is what keeps the
 * interrupted sweep off a build that is simply slow. A terminal status also
 * closes the run out; `ready` is the only one that sets `readyAt`.
 */
export async function recordDeploymentStatus(
  db: Database,
  deploymentId: string,
  update: DeploymentStatusUpdate,
): Promise<DeploymentRow | null> {
  const now = new Date();
  const terminal = isTerminalDeploymentStatus(update.status);
  const [row] = await db
    .update(deployments)
    .set({
      status: update.status,
      phase: update.phase ?? null,
      heartbeatAt: now,
      ...(update.port === undefined ? {} : { port: update.port }),
      ...(update.imageTag === undefined ? {} : { imageTag: update.imageTag }),
      ...(update.containerId === undefined
        ? {}
        : { containerId: update.containerId }),
      ...(update.imageSizeBytes === undefined
        ? {}
        : { imageSizeBytes: update.imageSizeBytes }),
      ...(update.buildDurationMs === undefined
        ? {}
        : { buildDurationMs: update.buildDurationMs }),
      ...(update.error === undefined ? {} : { error: update.error }),
      ...(update.status === "ready" ? { readyAt: now } : {}),
      ...(terminal && update.status !== "ready" ? { stoppedAt: now } : {}),
    })
    .where(eq(deployments.id, deploymentId))
    .returning();
  return row ?? null;
}

const LIVE_STATUSES: readonly DeploymentStatus[] = [
  "queued",
  "building",
  "deploying",
  "ready",
];

/**
 * Pushing five times in a minute must produce one build, not five. Keyed on the
 * ref rather than the hostname the plan names: a preview hostname carries a
 * random suffix, so two pushes to one branch never share one and a hostname
 * match would supersede nothing.
 *
 * Only `queued` rows are taken. A build already running has a container and a
 * log someone may be watching; `supersedeOlderDeployments` retires it when the
 * newer one goes ready.
 *
 * The whole row comes back rather than the four fields the caller strictly
 * needs, because these two functions are the one path to a terminal status that
 * does not go through `recordDeploymentStatus` — so everything the status route
 * does afterwards has to be done here instead, from releasing the DNS record to
 * closing out the check run on the commit.
 */
export async function supersedeQueuedDeployments(
  db: Database,
  input: { targetId: string; gitRef: string; kind: DeploymentKind },
): Promise<DeploymentRow[]> {
  return db
    .update(deployments)
    .set({
      status: "superseded",
      stoppedAt: new Date(),
      phase: null,
      error: "A newer commit was pushed before this build started",
    })
    .where(
      and(
        eq(deployments.targetId, input.targetId),
        eq(deployments.gitRef, input.gitRef),
        eq(deployments.kind, input.kind),
        eq(deployments.status, "queued"),
      ),
    )
    .returning();
}

/**
 * A pull request on a branch of the same repository fires `push` *and*
 * `pull_request synchronize` for one commit. Both resolve to the same target,
 * kind and SHA, so the second one finds the first here and enqueues nothing —
 * which is cheaper and less confusing than building twice and superseding.
 *
 * Every status but one counts, not just the in-flight ones. Matching only what
 * was still running lost the race whenever the first build finished inside the
 * seconds between the two events — a fast target then built the same commit
 * twice — and it also re-queued a build the owner had just cancelled, because a
 * cancelled row looked like no row at all.
 *
 * `superseded` is the exception, and it is the only status that describes a
 * build that never happened: a newer commit replaced it before it started. A
 * SHA coming back after that — a revert of a force-push, a branch reset — is a
 * commit nothing has built yet, so it is not a duplicate of anything.
 *
 * `failed`, `cancelled` and `interrupted` all deduplicate. A redelivered
 * webhook is not a request to try again; `POST /deployments/:id/retry` is.
 */
const SUPERSEDED: DeploymentStatus = "superseded";

export async function findDeploymentForSha(
  db: Database,
  input: { targetId: string; sha: string; kind: DeploymentKind },
): Promise<DeploymentRow | null> {
  const [row] = await db
    .select()
    .from(deployments)
    .where(
      and(
        eq(deployments.targetId, input.targetId),
        eq(deployments.gitSha, input.sha),
        eq(deployments.kind, input.kind),
        ne(deployments.status, SUPERSEDED),
      ),
    )
    // Newest first: a retried commit has several rows, and the one a caller
    // wants to attach a pull request number to is the current attempt.
    .orderBy(desc(deployments.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * Every preview built for a branch, for teardown when that branch goes away.
 *
 * Matching on the branch is what makes this work at all. A preview built from a
 * `push` carries `prNumber: null` — the number is only backfilled when the
 * `pull_request` event happens to arrive while that build is still in flight,
 * which in practice only Dependabot achieves because it opens the PR and pushes
 * at the same moment. Every preview of a hand-pushed branch therefore had a null
 * number, and a teardown keyed on the number alone matched nothing and left the
 * containers running for good.
 *
 * The number is still accepted, because a PR retargeted onto a new head branch
 * leaves rows under the old ref that only the number still reaches.
 *
 * Restricted to previews. The branch is attacker-adjacent input — a fork PR
 * names its own head ref — and without the filter a head branch named the same
 * as a production branch would tear down the live site.
 */
export async function branchPreviewDeployments(
  db: Database,
  input: { targetId: string; gitRef: string; prNumber?: number | null },
): Promise<DeploymentRow[]> {
  const matchesBranch = eq(deployments.gitRef, input.gitRef);
  return db
    .select()
    .from(deployments)
    .where(
      and(
        eq(deployments.targetId, input.targetId),
        eq(deployments.kind, "preview"),
        typeof input.prNumber === "number"
          ? or(matchesBranch, eq(deployments.prNumber, input.prNumber))
          : matchesBranch,
      ),
    );
}

/**
 * Attaches a pull request number to the previews already built for its head
 * branch. Runs on every `pull_request` event rather than only while a build is
 * in flight, so a branch pushed before its PR existed still gets the number the
 * PR comment and GitHub's environment inactivation both need.
 */
export async function backfillPullRequestNumber(
  db: Database,
  input: { targetId: string; gitRef: string; prNumber: number },
): Promise<void> {
  await db
    .update(deployments)
    .set({ prNumber: input.prNumber })
    .where(
      and(
        eq(deployments.targetId, input.targetId),
        eq(deployments.kind, "preview"),
        eq(deployments.gitRef, input.gitRef),
        isNull(deployments.prNumber),
      ),
    );
}

/**
 * Called when a deployment goes ready. The agent has already reaped the
 * containers those rows named; this is the database catching up, and it is
 * what stops the UI showing two live production deployments.
 */
export async function supersedeOlderDeployments(
  db: Database,
  input: { targetId: string; kind: DeploymentKind; keepDeploymentId: string },
): Promise<DeploymentRow[]> {
  return db
    .update(deployments)
    .set({ status: "superseded", stoppedAt: new Date(), phase: null })
    .where(
      and(
        eq(deployments.targetId, input.targetId),
        eq(deployments.kind, input.kind),
        ne(deployments.id, input.keepDeploymentId),
        inArray(deployments.status, [...LIVE_STATUSES]),
      ),
    )
    .returning();
}
