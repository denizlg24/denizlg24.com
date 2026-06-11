import mongoose from "mongoose";
import {
  KNOWLEDGE_MIGRATION_COLLECTION,
  KNOWLEDGE_MIGRATION_MANIFEST_ID,
  type KnowledgeMigrationManifest,
  type KnowledgeMigrationNoteTracking,
  type KnowledgeMigrationTrackingDocument,
} from "@/lib/knowledge-migration";
import { connectDB } from "@/lib/mongodb";
import { categorizeNotesBatch } from "@/lib/note-categorize";
import {
  buildAncestorMap,
  pruneRedundantAncestors,
} from "@/lib/note-group-hierarchy";
import { type ILeanNote, Note } from "@/models/Note";
import { type ILeanNoteGroup, NoteGroup } from "@/models/NoteGroup";

const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = 20;

function normalizeName(name: string) {
  return name.trim().toLowerCase();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = Array.from({ length: a.length + 1 }, (_, row) =>
    Array.from({ length: b.length + 1 }, (_, col) =>
      row === 0 ? col : col === 0 ? row : 0,
    ),
  );

  for (let row = 1; row <= a.length; row += 1) {
    for (let col = 1; col <= b.length; col += 1) {
      const cost = a[row - 1] === b[col - 1] ? 0 : 1;
      matrix[row][col] = Math.min(
        matrix[row - 1][col] + 1,
        matrix[row][col - 1] + 1,
        matrix[row - 1][col - 1] + cost,
      );
    }
  }

  return matrix[a.length][b.length];
}

function buildFolderTree(
  legacyFolders: KnowledgeMigrationManifest["legacyFolders"],
) {
  const childrenByParent = new Map<string | null, typeof legacyFolders>();

  for (const folder of legacyFolders) {
    const key = folder.parentOldId ?? null;
    const list = childrenByParent.get(key) ?? [];
    list.push(folder);
    childrenByParent.set(key, list);
  }

  const lines: string[] = [];
  const walk = (parentOldId: string | null, depth: number) => {
    const children = (childrenByParent.get(parentOldId) ?? []).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const child of children) {
      lines.push(`${"  ".repeat(depth)}- ${child.name}`);
      walk(child.oldId, depth + 1);
    }
  };

  walk(null, 0);
  return lines.join("\n");
}

async function resolveGroupId(
  name: string,
  groups: ILeanNoteGroup[],
): Promise<string | null> {
  const normalized = normalizeName(name);
  let bestMatch: ILeanNoteGroup | null = null;

  for (const group of groups) {
    const current = normalizeName(group.name);
    if (current === normalized) return String(group._id);
    if (current.includes(normalized) || normalized.includes(current)) {
      bestMatch = group;
      break;
    }
    if (levenshtein(current, normalized) <= 2) {
      bestMatch = group;
      break;
    }
  }

  return bestMatch ? String(bestMatch._id) : null;
}

async function main() {
  await connectDB();
  const db = mongoose.connection.db;

  if (!db) {
    throw new Error("Mongo database connection not available");
  }

  const trackingCollection = db.collection<KnowledgeMigrationTrackingDocument>(
    KNOWLEDGE_MIGRATION_COLLECTION,
  );

  const [manifest, trackingDocs, notes, groups] = await Promise.all([
    trackingCollection.findOne<KnowledgeMigrationManifest>({
      _id: KNOWLEDGE_MIGRATION_MANIFEST_ID,
      kind: "manifest",
    }),
    trackingCollection
      .find<KnowledgeMigrationNoteTracking>({
        kind: "note-tracking",
        source: "legacy-note",
        categorizedAt: null,
      })
      .toArray(),
    Note.find().lean<ILeanNote[]>().exec(),
    NoteGroup.find().sort({ name: 1 }).lean<ILeanNoteGroup[]>().exec(),
  ]);

  if (!manifest) {
    throw new Error(
      "Knowledge migration manifest not found. Run migrate-knowledge.ts first.",
    );
  }

  if (trackingDocs.length === 0) {
    console.log("No uncategorized migrated legacy notes found.");
    return;
  }

  const folderTree = buildFolderTree(manifest.legacyFolders);
  const noteById = new Map(
    notes.map((note) => [String(note._id), note] as const),
  );
  const candidateNotes = notes.map((note) => ({
    id: String(note._id),
    title: note.title,
    content: (note.content ?? "").slice(0, 160),
    url: note.url,
    groupIds: note.groupIds ?? [],
    tags: note.tags ?? [],
  }));

  const pendingNoteIds = trackingDocs
    .map((tracking) => tracking.newNoteId)
    .filter((noteId) => noteById.has(noteId));

  let processed = 0;

  for (let index = 0; index < pendingNoteIds.length; index += BATCH_SIZE) {
    const batchIds = pendingNoteIds.slice(index, index + BATCH_SIZE);
    const batchNotes = batchIds
      .map((noteId) => noteById.get(noteId))
      .filter((note): note is ILeanNote => Boolean(note))
      .map((note) => ({
        id: String(note._id),
        title: note.title,
        content: (note.content ?? "").slice(0, 500),
      }));

    const results = await categorizeNotesBatch({
      notes: batchNotes,
      candidateNotes,
      groups: groups.map((group) => ({
        id: String(group._id),
        name: group.name,
        description: group.description,
        parentId: group.parentId ?? null,
      })),
      folderTree,
    });

    if (DRY_RUN) {
      console.log(`\nBatch ${Math.floor(index / BATCH_SIZE) + 1}`);
      console.log(JSON.stringify(results, null, 2));
      processed += results.length;
      continue;
    }

    for (const result of results) {
      const note = noteById.get(result.id);
      if (!note) continue;

      const resolvedGroupIds = new Set<string>();
      for (const groupId of result.joinGroupIds ?? []) {
        if (groups.some((group) => String(group._id) === groupId)) {
          resolvedGroupIds.add(groupId);
        }
      }

      const createdGroups: Array<{ id: string; parentName?: string | null }> =
        [];

      for (const newGroup of result.newGroups ?? []) {
        const trimmedName = newGroup.name?.trim();
        if (!trimmedName) continue;

        const existingGroupId = await resolveGroupId(trimmedName, groups);
        if (existingGroupId) {
          resolvedGroupIds.add(existingGroupId);
          createdGroups.push({
            id: existingGroupId,
            parentName: newGroup.parentName ?? null,
          });
          continue;
        }

        const created = await NoteGroup.create({
          name: trimmedName,
          autoCreated: true,
        });

        const leanCreated = {
          ...created.toObject(),
          _id: created._id.toString(),
          parentId: created.parentId ? String(created.parentId) : null,
        } satisfies ILeanNoteGroup;

        groups.push(leanCreated);
        resolvedGroupIds.add(created._id.toString());
        createdGroups.push({
          id: created._id.toString(),
          parentName: newGroup.parentName ?? null,
        });
      }

      for (const createdGroup of createdGroups) {
        if (!createdGroup.parentName) continue;
        const parentGroupId = await resolveGroupId(
          createdGroup.parentName,
          groups,
        );
        if (!parentGroupId || parentGroupId === createdGroup.id) continue;

        await NoteGroup.updateOne(
          { _id: createdGroup.id },
          { $set: { parentId: new mongoose.Types.ObjectId(parentGroupId) } },
        ).exec();

        const localGroup = groups.find(
          (group) => String(group._id) === createdGroup.id,
        );
        if (localGroup) {
          localGroup.parentId = parentGroupId;
        }
      }

      const ancestorMap = buildAncestorMap(
        groups.map((group) => ({
          _id: String(group._id),
          parentId: group.parentId ?? null,
        })),
      );

      const mergedGroupIds = pruneRedundantAncestors(
        [...resolvedGroupIds],
        ancestorMap,
      );

      const update: Record<string, unknown> = {
        tags: [...new Set((result.tags ?? []).slice(0, 2))],
        groupIds: mergedGroupIds.map(
          (groupId) => new mongoose.Types.ObjectId(groupId),
        ),
        status: result.status === "archived" ? "archived" : "open",
      };

      await Note.updateOne({ _id: result.id }, { $set: update }).exec();

      const localNote = noteById.get(result.id);
      if (localNote) {
        localNote.tags = update.tags as string[];
        localNote.groupIds = mergedGroupIds;
        localNote.status = update.status as "open" | "archived";
      }

      await trackingCollection.updateOne(
        { kind: "note-tracking", newNoteId: result.id },
        { $set: { categorizedAt: new Date(), updatedAt: new Date() } },
      );
    }

    processed += results.length;
    console.log(
      `Processed ${processed} of ${pendingNoteIds.length} migrated legacy notes.`,
    );
  }

  if (DRY_RUN) {
    console.log(
      `\nDry run complete. Printed ${processed} categorization result(s) without applying changes.`,
    );
    return;
  }

  console.log("Legacy note categorization complete.");
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("Legacy note categorization failed:", error);
    process.exit(1);
  });
