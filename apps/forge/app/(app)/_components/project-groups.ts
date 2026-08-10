/**
 * Groups anything Forge-labelled by project, production ahead of previews.
 *
 * The hierarchy is the point: one project has at most one production release and
 * any number of branch previews, and a flat list makes the two indistinguishable
 * at a glance. Production is returned separately rather than sorted to the front
 * so a renderer can inset the previews under it without re-deriving which is
 * which.
 */
export interface ProjectGroup<T> {
  projectSlug: string;
  production: T[];
  previews: T[];
  /** Production plus previews, for counts and empty checks. */
  all: T[];
}

/** Anything with no project label at all, so nothing is silently dropped. */
export const UNGROUPED = "—";

export function groupByProject<T>(
  items: readonly T[],
  select: (item: T) => { projectSlug: string | null; kind: string | null },
  /**
   * `"alphabetical"` for a list with no order of its own. `"input"` keeps the
   * order the items arrived in, which is what a server-sorted list needs: a page
   * sorted by build time or status, then regrouped alphabetically, no longer runs
   * top-to-bottom in the order the sort control claims.
   */
  order: "alphabetical" | "input" = "alphabetical",
): ProjectGroup<T>[] {
  const groups = new Map<string, ProjectGroup<T>>();

  for (const item of items) {
    const { projectSlug, kind } = select(item);
    const slug = projectSlug ?? UNGROUPED;
    const group = groups.get(slug) ?? {
      projectSlug: slug,
      production: [],
      previews: [],
      all: [],
    };
    // Anything not explicitly production is treated as a preview. A missing
    // label is far more likely to be a preview than the live release, and
    // showing it inset understates it rather than promoting it wrongly.
    if (kind === "production") group.production.push(item);
    else group.previews.push(item);
    group.all.push(item);
    groups.set(slug, group);
  }

  // Insertion order is first-appearance order, which is exactly what `"input"`
  // wants.
  const ordered = [...groups.values()];
  if (order === "input") return ordered;
  return ordered.sort((left, right) => {
    // The unlabelled bucket last, whatever it sorts as alphabetically.
    if (left.projectSlug === UNGROUPED) return 1;
    if (right.projectSlug === UNGROUPED) return -1;
    return left.projectSlug.localeCompare(right.projectSlug);
  });
}
