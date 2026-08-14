import {
  type DeploymentKind,
  deriveMemoryCeilingMb,
  environmentHostnameLabel,
  matchBranchRule,
} from "@repo/schemas/cloud";
import { and, asc, eq } from "drizzle-orm";
import type { Database } from "../db";
import {
  type DeployBranchRuleRow,
  type DeployEnvironmentRow,
  type DeployTargetRow,
  deployBranchRules,
  deployEnvironments,
} from "../db/schema";

/** What a branch push turns out to be. `null` means nothing is built. */
export interface BranchRoute {
  kind: DeploymentKind;
  /** Set exactly when `kind` is `environment`. */
  environmentId: string | null;
  /** The rule that decided it, for reporting. Null for production and preview. */
  ruleId: string | null;
}

export interface BranchRoutingConfig {
  productionBranch: string;
  previewDeploys: boolean;
  rules: readonly DeployBranchRuleRow[];
}

/**
 * The whole branch-to-environment decision, in one place and with one order:
 *
 * 1. The production branch is production. It is checked first and unconditionally
 *    — a rule that also matched `main` would otherwise be able to divert the live
 *    site into staging, which is not a thing any rule set should be able to say.
 * 2. The highest-priority enabled rule that matches.
 * 3. A preview, if the target still has previews on.
 *
 * Returns null for a branch that matches nothing with previews off, which is the
 * "build only what I have named" configuration.
 */
export function resolveBranchRoute(
  branch: string,
  config: BranchRoutingConfig,
): BranchRoute | null {
  if (branch === config.productionBranch) {
    return { kind: "production", environmentId: null, ruleId: null };
  }
  const rule = matchBranchRule(config.rules, branch);
  if (rule) {
    return {
      kind: "environment",
      environmentId: rule.environmentId,
      ruleId: rule.id,
    };
  }
  if (!config.previewDeploys) return null;
  return { kind: "preview", environmentId: null, ruleId: null };
}

/**
 * Ordered the way `resolveBranchRoute` expects to read them: priority ascending,
 * then oldest first so that two rules sharing a priority resolve the same way on
 * every request rather than however the planner returned them.
 */
export async function branchRulesForTarget(
  db: Database,
  targetId: string,
): Promise<DeployBranchRuleRow[]> {
  return db
    .select()
    .from(deployBranchRules)
    .where(eq(deployBranchRules.targetId, targetId))
    .orderBy(asc(deployBranchRules.priority), asc(deployBranchRules.createdAt));
}

export async function environmentsForTarget(
  db: Database,
  targetId: string,
): Promise<DeployEnvironmentRow[]> {
  return db
    .select()
    .from(deployEnvironments)
    .where(eq(deployEnvironments.targetId, targetId))
    .orderBy(asc(deployEnvironments.createdAt));
}

export async function findEnvironment(
  db: Database,
  input: { targetId: string; environmentId: string },
): Promise<DeployEnvironmentRow | null> {
  const row = await db.query.deployEnvironments.findFirst({
    where: and(
      eq(deployEnvironments.id, input.environmentId),
      eq(deployEnvironments.targetId, input.targetId),
    ),
  });
  return row ?? null;
}

export async function findEnvironmentByName(
  db: Database,
  input: { targetId: string; name: string },
): Promise<DeployEnvironmentRow | null> {
  const row = await db.query.deployEnvironments.findFirst({
    where: and(
      eq(deployEnvironments.targetId, input.targetId),
      eq(deployEnvironments.name, input.name),
    ),
  });
  return row ?? null;
}

/**
 * The memory an environment slot is admitted and run with. Null on the
 * environment inherits the target, so raising a target's reservation raises
 * every environment that never overrode it — the same rule `memoryCeilingMb`
 * already applies between reservation and ceiling.
 */
export function environmentMemory(
  target: Pick<DeployTargetRow, "memoryReservationMb" | "memoryLimitMb">,
  environment: Pick<
    DeployEnvironmentRow,
    "memoryReservationMb" | "memoryLimitMb"
  > | null,
): { reservationMb: number; ceilingMb: number } {
  const reservationMb =
    environment?.memoryReservationMb ?? target.memoryReservationMb;
  const ceilingMb =
    environment?.memoryLimitMb ??
    (environment?.memoryReservationMb != null
      ? deriveMemoryCeilingMb(environment.memoryReservationMb)
      : (target.memoryLimitMb ?? deriveMemoryCeilingMb(reservationMb)));
  return { reservationMb, ceilingMb };
}

/**
 * The stable name an environment answers on, generated once at creation.
 *
 * Collision is retried rather than assumed away: the suffix is six random
 * characters and the hostname column is unique, so a clash is a failed insert
 * that nobody would understand from the error. Three attempts is far past the
 * point where a collision is plausible.
 */
export async function allocateEnvironmentHostname(
  db: Database,
  input: { projectSlug: string; environment: string; zoneName: string },
): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const hostname = `${environmentHostnameLabel({
      projectSlug: input.projectSlug,
      environment: input.environment,
    })}.${input.zoneName}`;
    const taken = await db.query.deployEnvironments.findFirst({
      where: eq(deployEnvironments.hostname, hostname),
    });
    if (!taken) return hostname;
  }
  throw new Error("Could not allocate an environment hostname");
}

/**
 * What the `deployment.environment` binding resolves to: the name people
 * configure against rather than the enum. Production and preview have no row,
 * and naming them here is what makes the binding answer for every deployment
 * instead of only the custom ones.
 */
export function environmentLabel(
  kind: DeploymentKind,
  environment: Pick<DeployEnvironmentRow, "name"> | null,
): string {
  if (kind === "environment") return environment?.name ?? "environment";
  return kind;
}
