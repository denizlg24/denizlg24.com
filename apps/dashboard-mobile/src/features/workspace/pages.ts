import type { WorkspacePageSummary } from "@repo/schemas";

export function pageTitle(page: { title: string }) {
  return page.title.trim() || "Untitled";
}

export function livePages(pages: WorkspacePageSummary[]) {
  const byId = new Map(pages.map((page) => [page.id, page]));
  return pages.filter((page) => {
    const seen = new Set<string>();
    let current: WorkspacePageSummary | undefined = page;
    while (current) {
      if (current.deletedAt || current.template || seen.has(current.id))
        return false;
      seen.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return true;
  });
}

export function pagePath(
  page: WorkspacePageSummary,
  pages: WorkspacePageSummary[],
) {
  const byId = new Map(pages.map((item) => [item.id, item]));
  const ancestors: string[] = [];
  const seen = new Set([page.id]);
  let parent = page.parentId ? byId.get(page.parentId) : undefined;
  while (parent && !seen.has(parent.id)) {
    seen.add(parent.id);
    ancestors.unshift(pageTitle(parent));
    parent = parent.parentId ? byId.get(parent.parentId) : undefined;
  }
  return ancestors.join(" / ");
}

export function findPages(
  pages: WorkspacePageSummary[],
  search: string,
  parentId: string | null = null,
) {
  const query = search.trim().toLocaleLowerCase();
  return livePages(pages)
    .filter((page) =>
      query
        ? `${pageTitle(page)} ${pagePath(page, pages)}`
            .toLocaleLowerCase()
            .includes(query)
        : page.parentId === parentId,
    )
    .sort((a, b) =>
      query
        ? pageTitle(a).localeCompare(pageTitle(b))
        : a.order - b.order || a.id.localeCompare(b.id),
    );
}
