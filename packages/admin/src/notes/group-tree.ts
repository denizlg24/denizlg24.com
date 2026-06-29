import type { INoteGroup } from "@repo/schemas";
import {
  ancestorIds,
  descendantIdSet,
  groupByParent,
  indexById,
} from "@repo/utils";

export function buildGroupById<TGroup extends INoteGroup>(groups: TGroup[]) {
  return indexById(groups, (group) => group._id);
}

export function buildChildrenByParent<TGroup extends INoteGroup>(
  groups: TGroup[],
) {
  return groupByParent(
    groups,
    (group) => group.parentId ?? null,
    (left, right) => left.name.localeCompare(right.name),
  );
}

export function collectAncestorIds(
  groupId: string,
  byId: Map<string, INoteGroup>,
): string[] {
  return ancestorIds(groupId, (id) => byId.get(id)?.parentId ?? null, {
    includeSelf: true,
  });
}

export function buildPathLabelMap<TGroup extends INoteGroup>(groups: TGroup[]) {
  const byId = buildGroupById(groups);
  const pathLabelById = new Map<string, string>();

  const resolve = (groupId: string): string => {
    const cached = pathLabelById.get(groupId);
    if (cached) return cached;

    const visited = new Set<string>();
    const parts: string[] = [];
    let currentId: string | null | undefined = groupId;

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const current = byId.get(currentId);
      if (!current) break;
      parts.push(current.name);
      currentId = current.parentId ?? null;
    }

    const label = parts.reverse().join(" / ");
    pathLabelById.set(groupId, label);
    return label;
  };

  for (const group of groups) {
    resolve(group._id);
  }

  return pathLabelById;
}

export function buildDescendantIdMap<TGroup extends INoteGroup>(
  groups: TGroup[],
) {
  const childrenByParent = buildChildrenByParent(groups);
  const descendantIdsByGroup = new Map<string, Set<string>>();

  for (const group of groups) {
    descendantIdsByGroup.set(
      group._id,
      descendantIdSet(group._id, childrenByParent, (child) => child._id, {
        includeRoot: true,
      }),
    );
  }

  return descendantIdsByGroup;
}
