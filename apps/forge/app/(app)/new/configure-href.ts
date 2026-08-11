import type { ImportRepo } from "@repo/cloud-ui/deploy/repo-import";

/**
 * The repository travels in the URL rather than in memory, so `/new/configure`
 * survives a reload and the back button lands on the picker instead of on a
 * blank form. These four fields are everything the import reads off a
 * repository; the alternative was refetching every installation's repository
 * list on the configure step to find the row the picker already had.
 */
export function configureHref(repo: ImportRepo): string {
  const query = new URLSearchParams({
    owner: repo.owner,
    repo: repo.name,
    installation: String(repo.installationId),
    branch: repo.defaultBranch,
  });
  return `/new/configure?${query.toString()}`;
}

export function importRepoFromQuery(
  params: URLSearchParams,
): ImportRepo | null {
  const owner = params.get("owner");
  const name = params.get("repo");
  const installationId = Number(params.get("installation"));
  const defaultBranch = params.get("branch");
  if (!owner || !name || !defaultBranch || !Number.isInteger(installationId)) {
    return null;
  }
  return {
    defaultBranch,
    fullName: `${owner}/${name}`,
    installationId,
    name,
    owner,
  };
}
