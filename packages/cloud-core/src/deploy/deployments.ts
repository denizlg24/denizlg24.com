import {
  type AgentDeploymentRequest,
  type DeploymentKind,
  type DeploymentStatus,
  type DeploymentStatusUpdate,
  isTerminalDeploymentStatus,
} from "@repo/schemas/cloud";
import { and, eq, inArray, ne, sql } from "drizzle-orm";

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
 */
export async function claimQueuedDeployment(
  db: Database,
): Promise<DeploymentRow | null> {
  const claimed = await db.execute(sql<{ id: string }>`
    WITH claimed AS (
      SELECT id FROM ${deployments}
      WHERE ${deployments.status} = 'queued'
      ORDER BY ${deployments.createdAt}
      FOR UPDATE SKIP LOCKED
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
    build: {
      builder: target.builder,
      ...(target.rootDirectory ? { rootDirectory: target.rootDirectory } : {}),
      ...(target.dockerfilePath
        ? { dockerfilePath: target.dockerfilePath }
        : {}),
      ...(target.installCommand
        ? { installCommand: target.installCommand }
        : {}),
      ...(target.buildCommand ? { buildCommand: target.buildCommand } : {}),
      ...(target.startCommand ? { startCommand: target.startCommand } : {}),
    },
    runtime: {
      healthPath: target.healthPath,
      memoryLimitMb: target.memoryLimitMb,
      cpuLimit: Number(target.cpuLimit),
    },
    timeouts: { buildMs: 20 * 60_000, healthMs: 90_000 },
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
 * Called when a deployment goes ready. The agent has already reaped the
 * containers those rows named; this is the database catching up, and it is
 * what stops the UI showing two live production deployments.
 */
export async function supersedeOlderDeployments(
  db: Database,
  input: { targetId: string; kind: DeploymentKind; keepDeploymentId: string },
): Promise<string[]> {
  const rows = await db
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
    .returning({ id: deployments.id });
  return rows.map((row) => row.id);
}
