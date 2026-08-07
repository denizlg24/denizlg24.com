import type { GithubInstallationEvent } from "@repo/schemas/cloud";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../../db";
import {
  type DeployGithubInstallationRow,
  type DeployTargetRow,
  deployGithubInstallations,
  deployTargets,
} from "../../db/schema";

interface RepositoryRef {
  owner: string;
  name: string;
}

function splitFullName(fullName: string): RepositoryRef | null {
  const [owner, name] = fullName.split("/");
  return owner && name ? { owner, name } : null;
}

function repositoryKey(repository: RepositoryRef): string {
  return `${repository.owner.toLowerCase()}/${repository.name.toLowerCase()}`;
}

function readRepositories(
  listed: { full_name: string }[] | null | undefined,
): RepositoryRef[] {
  return (listed ?? []).flatMap((repository) => {
    const split = splitFullName(repository.full_name);
    return split ? [split] : [];
  });
}

/**
 * Mirrors what GitHub says about an installation so the UI can offer the repos
 * it may deploy without asking for a token first. `installation_repositories`
 * arrives as a delta, so the removed set is subtracted from what is stored
 * rather than replacing it.
 */
export async function recordGithubInstallation(
  db: Database,
  event: GithubInstallationEvent,
): Promise<DeployGithubInstallationRow | null> {
  const installation = event.installation;
  if (event.action === "deleted") {
    await removeGithubInstallation(db, installation.id);
    return null;
  }

  const existing = await db.query.deployGithubInstallations.findFirst({
    where: eq(deployGithubInstallations.installationId, installation.id),
  });
  // `installation` carries the full list and replaces what is stored;
  // `installation_repositories` carries only what changed, so it merges.
  const removed = new Set(
    readRepositories(event.repositories_removed).map(repositoryKey),
  );
  const merged = event.repositories
    ? readRepositories(event.repositories)
    : [
        ...new Map(
          [
            ...(existing?.repositories ?? []),
            ...readRepositories(event.repositories_added),
          ].map((repository) => [repositoryKey(repository), repository]),
        ).values(),
      ].filter((repository) => !removed.has(repositoryKey(repository)));

  const values = {
    installationId: installation.id,
    accountLogin: installation.account?.login ?? "unknown",
    accountType: installation.account?.type ?? "unknown",
    repositorySelection: installation.repository_selection ?? "selected",
    repositories: merged,
    suspendedAt: installation.suspended_at
      ? new Date(installation.suspended_at)
      : null,
    updatedAt: new Date(),
  };

  const [row] = await db
    .insert(deployGithubInstallations)
    .values(values)
    .onConflictDoUpdate({
      target: deployGithubInstallations.installationId,
      set: values,
    })
    .returning();
  return row ?? null;
}

/**
 * The targets keep their `githubInstallationId`. Clearing it would silently
 * turn every one of them into a manual-deploy target with nothing saying why;
 * leaving it means reinstalling the App restores them, and a deploy attempted
 * in between fails with an installation error that names the cause.
 */
export async function removeGithubInstallation(
  db: Database,
  installationId: number,
): Promise<void> {
  await db
    .delete(deployGithubInstallations)
    .where(eq(deployGithubInstallations.installationId, installationId));
}

export async function listGithubInstallations(
  db: Database,
): Promise<DeployGithubInstallationRow[]> {
  return db.select().from(deployGithubInstallations);
}

/**
 * Every target backed by one repository. A repository may back several — the
 * same tree deployed from different root directories — and each gets its own
 * deployment.
 */
export async function targetsForRepository(
  db: Database,
  input: { owner: string; repo: string },
): Promise<DeployTargetRow[]> {
  // Case-insensitive because GitHub owner and repository names are, and a
  // target stored as `DenizLg24/site` must still match a webhook that says
  // `denizlg24/site`.
  return db
    .select()
    .from(deployTargets)
    .where(
      and(
        sql`lower(${deployTargets.repoOwner}) = ${input.owner.toLowerCase()}`,
        sql`lower(${deployTargets.repoName}) = ${input.repo.toLowerCase()}`,
      ),
    );
}
