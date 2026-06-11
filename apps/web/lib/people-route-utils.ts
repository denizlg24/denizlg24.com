import mongoose from "mongoose";
import {
  buildAncestorMap,
  pruneRedundantAncestors,
} from "@/lib/note-group-hierarchy";
import type { ILeanPerson, PersonSocial } from "@/models/Person";
import type { ILeanPersonEdge } from "@/models/PersonEdge";
import { type ILeanPersonGroup, PersonGroup } from "@/models/PersonGroup";

export function parsePersonSocials(value: unknown): PersonSocial[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: PersonSocial[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const data = raw as Record<string, unknown>;
    const platform =
      typeof data.platform === "string" ? data.platform.trim() : "";
    const handle = typeof data.handle === "string" ? data.handle.trim() : "";
    if (!platform || !handle) continue;
    const urlRaw = typeof data.url === "string" ? data.url.trim() : "";
    result.push({ platform, handle, url: urlRaw || undefined });
  }
  return result;
}

export function serializePerson(person: ILeanPerson) {
  return {
    ...person,
    _id: String(person._id),
    groupIds: (person.groupIds ?? []).map(String),
  };
}

export function serializePersonGroup(group: ILeanPersonGroup) {
  return {
    ...group,
    _id: String(group._id),
    parentId: group.parentId ? String(group.parentId) : null,
  };
}

export function serializePersonEdge(edge: ILeanPersonEdge) {
  return {
    ...edge,
    _id: String(edge._id),
    from: String(edge.from),
    to: String(edge.to),
  };
}

export async function prunePersonGroupIds(groupIds: string[]) {
  const deduped = [
    ...new Set(
      groupIds.filter(
        (groupId) =>
          typeof groupId === "string" &&
          mongoose.Types.ObjectId.isValid(groupId),
      ),
    ),
  ];

  if (deduped.length < 2) {
    return deduped.map((groupId) => new mongoose.Types.ObjectId(groupId));
  }

  const groups = await PersonGroup.find()
    .select("_id parentId")
    .lean<
      Array<{
        _id: mongoose.Types.ObjectId;
        parentId?: mongoose.Types.ObjectId | null;
      }>
    >()
    .exec();

  const ancestorMap = buildAncestorMap(
    groups.map((group) => ({
      _id: String(group._id),
      parentId: group.parentId ? String(group.parentId) : null,
    })),
  );

  return pruneRedundantAncestors(deduped, ancestorMap).map(
    (groupId) => new mongoose.Types.ObjectId(groupId),
  );
}

export function canonicalPersonPair(left: string, right: string) {
  return left < right ? [left, right] : [right, left];
}
