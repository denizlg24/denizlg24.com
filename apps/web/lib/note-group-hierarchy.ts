import type { ILeanNoteGroup } from "@/models/NoteGroup";

export type GroupLike = Pick<ILeanNoteGroup, "_id" | "parentId">;

export type AncestorMap = Map<string, Set<string>>;

export function buildAncestorMap(groups: GroupLike[]): AncestorMap {
  const parentById = new Map<string, string | null>();
  for (const group of groups) {
    parentById.set(
      String(group._id),
      group.parentId ? String(group.parentId) : null,
    );
  }

  const memo: AncestorMap = new Map();

  const resolve = (id: string, seen: Set<string>): Set<string> => {
    const cached = memo.get(id);
    if (cached) return cached;
    if (seen.has(id)) return new Set();

    seen.add(id);
    const ancestors = new Set<string>();
    const parentId = parentById.get(id) ?? null;
    if (parentId && parentById.has(parentId)) {
      ancestors.add(parentId);
      for (const ancestor of resolve(parentId, seen)) {
        ancestors.add(ancestor);
      }
    }

    memo.set(id, ancestors);
    return ancestors;
  };

  for (const id of parentById.keys()) {
    resolve(id, new Set());
  }

  return memo;
}

export function pruneRedundantAncestors<
  T extends string | { toString(): string },
>(groupIds: T[], ancestorMap: AncestorMap): T[] {
  if (groupIds.length < 2) return [...groupIds];

  const idSet = new Set(groupIds.map((groupId) => String(groupId)));
  const ancestorsOfAnyMember = new Set<string>();

  for (const id of idSet) {
    const ancestors = ancestorMap.get(id);
    if (!ancestors) continue;
    for (const ancestor of ancestors) {
      ancestorsOfAnyMember.add(ancestor);
    }
  }

  return groupIds.filter(
    (groupId) => !ancestorsOfAnyMember.has(String(groupId)),
  );
}

export function descendantIds(
  rootId: string,
  groups: GroupLike[],
): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const group of groups) {
    const parentId = group.parentId ? String(group.parentId) : null;
    if (!parentId) continue;
    const existing = childrenByParent.get(parentId) ?? [];
    existing.push(String(group._id));
    childrenByParent.set(parentId, existing);
  }

  const result = new Set<string>();
  const stack = [rootId];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    const children = childrenByParent.get(current) ?? [];
    for (const childId of children) {
      if (result.has(childId)) continue;
      result.add(childId);
      stack.push(childId);
    }
  }

  return result;
}
