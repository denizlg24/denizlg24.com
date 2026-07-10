import mongoose from "mongoose";
import {
  categorizeIncomingNote,
  type IncomingNoteCategorizeInput,
} from "@/lib/note-categorize";
import { pruneGroupIds } from "@/lib/note-route-utils";
import { type ILeanNoteGroup, NoteGroup } from "@/models/NoteGroup";

interface ResolveIncomingCategorizationInput {
  input: IncomingNoteCategorizeInput;
  manualTags?: string[];
  manualGroupIds?: string[];
}

export async function resolveIncomingCategorization({
  input,
  manualTags = [],
  manualGroupIds = [],
}: ResolveIncomingCategorizationInput) {
  const categorization = await categorizeIncomingNote(input);

  const groups = await NoteGroup.find()
    .select("_id name")
    .lean<ILeanNoteGroup[]>()
    .exec();
  const nameToId = new Map(
    groups.map((group) => [group.name, String(group._id)] as const),
  );

  const createdGroupIds: string[] = [];
  const pendingParentUpdates: Array<{
    groupId: string;
    parentName: string;
  }> = [];

  for (const newGroup of categorization.newGroups) {
    if (!newGroup.name) continue;

    const existingGroupId = nameToId.get(newGroup.name);
    if (existingGroupId) {
      createdGroupIds.push(existingGroupId);
      if (newGroup.parentName) {
        pendingParentUpdates.push({
          groupId: existingGroupId,
          parentName: newGroup.parentName,
        });
      }
      continue;
    }

    const createdGroup = await NoteGroup.create({
      name: newGroup.name,
      description: newGroup.description,
      autoCreated: true,
    });
    const createdGroupId = createdGroup._id.toString();
    nameToId.set(newGroup.name, createdGroupId);
    createdGroupIds.push(createdGroupId);

    if (newGroup.parentName) {
      pendingParentUpdates.push({
        groupId: createdGroupId,
        parentName: newGroup.parentName,
      });
    }
  }

  for (const update of categorization.groupUpdates ?? []) {
    if (!mongoose.Types.ObjectId.isValid(update.groupId)) continue;

    const patch: Record<string, unknown> = {};

    if (update.rename && typeof update.rename === "string") {
      const trimmed = update.rename.trim();
      if (trimmed.length > 0) {
        patch.name = trimmed;
        const previousEntry = [...nameToId.entries()].find(
          ([, id]) => id === update.groupId,
        );
        if (previousEntry) {
          nameToId.delete(previousEntry[0]);
        }
        nameToId.set(trimmed, update.groupId);
      }
    }

    if (update.parentName === null) {
      patch.parentId = null;
    } else if (update.parentName) {
      pendingParentUpdates.push({
        groupId: update.groupId,
        parentName: update.parentName,
      });
    }

    if (Object.keys(patch).length > 0) {
      await NoteGroup.findByIdAndUpdate(update.groupId, patch).exec();
    }
  }

  for (const pendingParentUpdate of pendingParentUpdates) {
    const parentId = nameToId.get(pendingParentUpdate.parentName);
    if (
      !parentId ||
      parentId === pendingParentUpdate.groupId ||
      !mongoose.Types.ObjectId.isValid(parentId)
    ) {
      continue;
    }

    await NoteGroup.findByIdAndUpdate(pendingParentUpdate.groupId, {
      parentId: new mongoose.Types.ObjectId(parentId),
    }).exec();
  }

  const tags = [
    ...new Set([...(manualTags ?? []), ...(categorization.tags ?? [])]),
  ];
  const groupIds = [
    ...new Set([
      ...manualGroupIds,
      ...(categorization.joinGroupIds ?? []).filter((groupId) =>
        mongoose.Types.ObjectId.isValid(groupId),
      ),
      ...createdGroupIds,
    ]),
  ];
  return {
    tags,
    groupIds: await pruneGroupIds(groupIds),
    relatedNoteIds: [],
  };
}
