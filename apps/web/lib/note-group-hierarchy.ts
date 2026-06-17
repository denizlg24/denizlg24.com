import { ancestorIds } from "@repo/utils";
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

  const parentOf = (id: string): string | null => {
    const parentId = parentById.get(id) ?? null;
    return parentId && parentById.has(parentId) ? parentId : null;
  };

  const ancestorsById: AncestorMap = new Map();
  for (const id of parentById.keys()) {
    ancestorsById.set(
      id,
      new Set(ancestorIds(id, parentOf, { includeSelf: false })),
    );
  }

  return ancestorsById;
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
