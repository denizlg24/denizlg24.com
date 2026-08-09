import {
  type DeployCapacity,
  type DeploymentKind,
  deriveMemoryCeilingMb,
} from "@repo/schemas/cloud";
import { and, inArray, ne, or, sql } from "drizzle-orm";

import type { Database } from "../db";
import { type DeployTargetRow, deployments } from "../db/schema";
import { ValidationError } from "../errors";

type CapacityDatabase =
  | Database
  | Parameters<Parameters<Database["transaction"]>[0]>[0];

const COMMITTED_STATUSES = [
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
 * Reservations held by every target/kind slot that is queued or live,
 * optionally ignoring the slot a new deployment will replace.
 *
 * A slot is counted once, not once per deployment: a redeploy replaces the
 * container it is superseding, so charging both would refuse every second
 * deploy on a nearly-full host. Production and preview are separate slots
 * because they genuinely run alongside one another.
 *
 * Queued and building slots count too. Admission would otherwise allow ten
 * requests through while the host was empty, only discovering the overcommit
 * after the builds finished.
 */
export async function committedReservationMb(
  db: CapacityDatabase,
  options: { excludeTargetId?: string; excludeKind?: DeploymentKind } = {},
): Promise<{ committedMb: number; targets: number }> {
  const rows = await db
    .selectDistinctOn([deployments.targetId, deployments.kind], {
      id: deployments.targetId,
      kind: deployments.kind,
      reservation: deployments.memoryReservationMb,
    })
    .from(deployments)
    .where(
      options.excludeTargetId && options.excludeKind
        ? and(
            inArray(deployments.status, [...COMMITTED_STATUSES]),
            or(
              ne(deployments.targetId, options.excludeTargetId),
              ne(deployments.kind, options.excludeKind),
            )!,
          )
        : inArray(deployments.status, [...COMMITTED_STATUSES]),
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
    requestedMb: number;
    allocatableMb: number | null;
  },
): Promise<void> {
  if (input.allocatableMb === null) return;
  const { committedMb } = await committedReservationMb(db, {
    excludeTargetId: input.targetId,
    excludeKind: input.kind,
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
