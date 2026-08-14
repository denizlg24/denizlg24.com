import {
  type DeployCapacity,
  type DeploymentKind,
  deriveMemoryCeilingMb,
} from "@repo/schemas/cloud";
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";

import type { Database } from "../db";
import {
  type DeployTargetRow,
  deployEnvironments,
  deployments,
  deployTargets,
} from "../db/schema";
import { ValidationError } from "../errors";

type CapacityDatabase =
  | Database
  | Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * A slot that is holding, or is about to hold, memory on the host. Pause tears
 * down exactly this set, which is what keeps the teardown and the reservation
 * arithmetic describing the same thing.
 */
export const COMMITTED_DEPLOYMENT_STATUSES = [
  "queued",
  "building",
  "deploying",
  "ready",
] as const;

/** Serializes the check-and-insert section of every enqueue request. */
export async function lockDeployCapacity(db: CapacityDatabase): Promise<void> {
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('forge:memory-capacity', 0))`,
  );
}

/**
 * What a target will actually be run with. The ceiling is derived rather than
 * stored so that moving the reservation moves the rope with it — a target
 * bumped from 256 to 512 should not still be killed at the old 1 GB.
 */
export function memoryCeilingMb(
  target: Pick<DeployTargetRow, "memoryReservationMb" | "memoryLimitMb">,
): number {
  return (
    target.memoryLimitMb ?? deriveMemoryCeilingMb(target.memoryReservationMb)
  );
}

export class CapacityExceededError extends ValidationError {
  readonly committedMb: number;
  readonly requestedMb: number;
  readonly allocatableMb: number;

  constructor(input: {
    committedMb: number;
    requestedMb: number;
    allocatableMb: number;
  }) {
    const short = input.committedMb + input.requestedMb - input.allocatableMb;
    super(
      `Not enough memory: ${input.committedMb} MB committed + ${input.requestedMb} MB requested exceeds ${input.allocatableMb} MB allocatable by ${short} MB`,
      "CAPACITY_EXCEEDED",
    );
    this.committedMb = input.committedMb;
    this.requestedMb = input.requestedMb;
    this.allocatableMb = input.allocatableMb;
  }
}

export function assertMemoryCapacity(input: {
  committedMb: number;
  requestedMb: number;
  allocatableMb: number;
}): void {
  if (input.committedMb + input.requestedMb <= input.allocatableMb) return;
  throw new CapacityExceededError(input);
}

/**
 * Reservations held by every slot that is queued or live, optionally ignoring
 * the slot a new deployment will replace.
 *
 * A slot is `(target, kind, environment)`. It is counted once, not once per
 * deployment: a redeploy replaces the container it is superseding, so charging
 * both would refuse every second deploy on a nearly-full host. Production,
 * preview and each custom environment are separate slots because they genuinely
 * run alongside one another — which is also the honest price of a custom
 * environment on a box with finite memory: one more continuous reservation.
 *
 * Queued and building slots count too. Admission would otherwise allow ten
 * requests through while the host was empty, only discovering the overcommit
 * after the builds finished.
 *
 * A paused target holds nothing, and neither does a paused environment. The
 * container was torn down when it was paused, so charging the host for a
 * reservation that is not running is the whole reason pause exists. The `ready`
 * row is left alone deliberately — it still records what was last deployed.
 */
export async function committedReservationMb(
  db: CapacityDatabase,
  options: {
    excludeTargetId?: string;
    excludeKind?: DeploymentKind;
    excludeEnvironmentId?: string | null;
  } = {},
): Promise<{ committedMb: number; targets: number }> {
  const excludesSlot =
    options.excludeTargetId !== undefined && options.excludeKind !== undefined;
  const rows = await db
    .selectDistinctOn(
      [deployments.targetId, deployments.kind, deployments.environmentId],
      {
        id: deployments.targetId,
        kind: deployments.kind,
        environmentId: deployments.environmentId,
        reservation: deployments.memoryReservationMb,
      },
    )
    .from(deployments)
    .innerJoin(deployTargets, eq(deployTargets.id, deployments.targetId))
    .leftJoin(
      deployEnvironments,
      eq(deployEnvironments.id, deployments.environmentId),
    )
    .where(
      and(
        isNull(deployTargets.pausedAt),
        // A left join leaves this null for production and preview rows, which
        // is why it is `is null` rather than a comparison: only an environment
        // row can be paused, and only that row must then drop out.
        isNull(deployEnvironments.pausedAt),
        inArray(deployments.status, [...COMMITTED_DEPLOYMENT_STATUSES]),
        excludesSlot
          ? or(
              ne(deployments.targetId, options.excludeTargetId as string),
              ne(deployments.kind, options.excludeKind as DeploymentKind),
              options.excludeEnvironmentId == null
                ? sql`${deployments.environmentId} is not null`
                : ne(deployments.environmentId, options.excludeEnvironmentId),
            )!
          : undefined,
      )!,
    );

  return {
    committedMb: rows.reduce((total, row) => total + row.reservation, 0),
    targets: new Set(rows.map((row) => row.id)).size,
  };
}

/**
 * The pre-flight check, in the same spirit as `assertBindingsResolvable`: it
 * runs at enqueue and never starts anything, because finding out after a
 * three-minute build that the host had no room is the failure worth avoiding.
 *
 * A null `allocatableMb` means the agent did not report memory — an older
 * binary, or a host that could not be read. That is treated as "unknown" and
 * skipped rather than as zero, since refusing every deploy is a worse failure
 * than the overcommit this is guarding against.
 */
export async function assertCapacityAvailable(
  db: CapacityDatabase,
  input: {
    targetId: string;
    kind: DeploymentKind;
    environmentId?: string | null;
    requestedMb: number;
    allocatableMb: number | null;
  },
): Promise<void> {
  if (input.allocatableMb === null) return;
  const { committedMb } = await committedReservationMb(db, {
    excludeTargetId: input.targetId,
    excludeKind: input.kind,
    excludeEnvironmentId: input.environmentId ?? null,
  });
  assertMemoryCapacity({
    committedMb,
    requestedMb: input.requestedMb,
    allocatableMb: input.allocatableMb,
  });
}

export async function deployCapacity(
  db: CapacityDatabase,
  allocatableMb: number | null,
): Promise<DeployCapacity> {
  const { committedMb, targets } = await committedReservationMb(db);
  return {
    allocatableMb,
    committedMb,
    targets,
    availableMb:
      allocatableMb === null ? null : Math.max(allocatableMb - committedMb, 0),
  };
}
