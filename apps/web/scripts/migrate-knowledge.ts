import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import mongoose from "mongoose";
import {
  KNOWLEDGE_MIGRATION_COLLECTION,
  KNOWLEDGE_MIGRATION_MANIFEST_ID,
  type KnowledgeMigrationManifest,
  type KnowledgeMigrationNoteTracking,
  type KnowledgeMigrationTrackingDocument,
} from "@/lib/knowledge-migration";
import { connectDB } from "@/lib/mongodb";
import { Bookmark, type ILeanBookmark } from "@/models/Bookmark";
import { BookmarkEdge, type ILeanBookmarkEdge } from "@/models/BookmarkEdge";
import { BookmarkGroup, type ILeanBookmarkGroup } from "@/models/BookmarkGroup";
import { Folder, type ILeanFolder } from "@/models/Folder";
import { JournalLog } from "@/models/Journal";
import { KanbanCard } from "@/models/KanbanCard";
import { Note } from "@/models/Note";
import { NoteEdge } from "@/models/NoteEdge";
import { NoteGroup } from "@/models/NoteGroup";
import {
  type ILeanNote as ILegacyLeanNote,
  Note as LegacyNote,
} from "@/models/Notes";

const DRY_RUN = process.argv.includes("--dry-run");
const LEGACY_COLLECTIONS = [
  "notes",
  "bookmarks",
  "folders",
  "bookmarkgroups",
  "bookmarkedges",
] as const;

interface FolderSeedDoc {
  _id: mongoose.Types.ObjectId;
  name: string;
  parentFolder?: mongoose.Types.ObjectId | null;
  notes: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

interface BookmarkGroupSeedDoc {
  _id: mongoose.Types.ObjectId;
  name: string;
  description?: string;
  color?: string;
  parentId?: mongoose.Types.ObjectId | null;
  autoCreated: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface LegacyNoteSeedDoc {
  _id: mongoose.Types.ObjectId;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

interface BookmarkSeedDoc {
  _id: mongoose.Types.ObjectId;
  url: string;
  title: string;
  description?: string;
  favicon?: string;
  image?: string;
  siteName?: string;
  tags: string[];
  groupIds: mongoose.Types.ObjectId[];
  content: string;
  publishedDate?: Date;
  status: "open" | "archived";
  class?: string;
  createdAt: Date;
  updatedAt: Date;
}

function isSelfParent(
  childId: string,
  parentId: string | null | undefined,
): boolean {
  return Boolean(parentId && parentId === childId);
}

async function promptYesNo(question: string, defaultValue = false) {
  const rl = createInterface({ input, output });
  try {
    const suffix = defaultValue ? " [Y/n] " : " [y/N] ";
    const answer = (await rl.question(`${question}${suffix}`))
      .trim()
      .toLowerCase();
    if (!answer) return defaultValue;
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

async function promptBackupConfirmation() {
  const confirmed = await promptYesNo(
    "Have you already created a mongodump backup of notes, bookmarks, folders, bookmarkgroups, and bookmarkedges?",
  );
  if (!confirmed) {
    throw new Error(
      "Backup confirmation missing. Run mongodump first, then rerun this script.",
    );
  }
}

function summarizeSamples(label: string, docs: unknown[]) {
  console.log(
    `\n${label} (${docs.length} sample${docs.length === 1 ? "" : "s"}):`,
  );
  console.log(JSON.stringify(docs, null, 2));
}

async function main() {
  await connectDB();
  const db = mongoose.connection.db;

  if (!db) {
    throw new Error("Mongo database connection not available");
  }

  console.log("Knowledge migration starting.");
  console.log(
    `Legacy collections to back up: ${LEGACY_COLLECTIONS.join(", ")}`,
  );

  if (!DRY_RUN) {
    await promptBackupConfirmation();
  } else {
    console.log("Dry run enabled. No writes will be performed.");
  }

  const trackingCollection = db.collection<KnowledgeMigrationTrackingDocument>(
    KNOWLEDGE_MIGRATION_COLLECTION,
  );

  const [existingNotes, existingGroups, existingEdges, existingTracking] =
    await Promise.all([
      Note.countDocuments(),
      NoteGroup.countDocuments(),
      NoteEdge.countDocuments(),
      trackingCollection.countDocuments(),
    ]);

  if (
    !DRY_RUN &&
    (existingNotes > 0 ||
      existingGroups > 0 ||
      existingEdges > 0 ||
      existingTracking > 0)
  ) {
    throw new Error(
      "Target unified collections are not empty. Aborting to avoid mixing migration runs.",
    );
  }

  const [folders, bookmarkGroups, legacyNotes, bookmarks, bookmarkEdges] =
    await Promise.all([
      Folder.find().lean<ILeanFolder[]>().exec(),
      BookmarkGroup.find().lean<ILeanBookmarkGroup[]>().exec(),
      LegacyNote.find().lean<ILegacyLeanNote[]>().exec(),
      Bookmark.find().lean<ILeanBookmark[]>().exec(),
      BookmarkEdge.find().lean<ILeanBookmarkEdge[]>().exec(),
    ]);

  const folderDocs = folders.map((folder) => ({
    _id: new mongoose.Types.ObjectId(String(folder._id)),
    name: folder.name,
    parentFolder: folder.parentFolder
      ? new mongoose.Types.ObjectId(String(folder.parentFolder))
      : null,
    notes: (folder.notes ?? []).map(
      (noteId) => new mongoose.Types.ObjectId(String(noteId)),
    ),
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
  })) satisfies FolderSeedDoc[];

  const bookmarkGroupDocs = bookmarkGroups.map((group) => ({
    _id: new mongoose.Types.ObjectId(String(group._id)),
    name: group.name,
    description: group.description,
    color: group.color,
    parentId: group.parentId
      ? new mongoose.Types.ObjectId(String(group.parentId))
      : null,
    autoCreated: group.autoCreated,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  })) satisfies BookmarkGroupSeedDoc[];

  const legacyNoteDocs = legacyNotes.map((note) => ({
    _id: new mongoose.Types.ObjectId(String(note._id)),
    title: note.title,
    content: note.content,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  })) satisfies LegacyNoteSeedDoc[];

  const bookmarkDocs = bookmarks.map((bookmark) => ({
    _id: new mongoose.Types.ObjectId(String(bookmark._id)),
    url: bookmark.url,
    title: bookmark.title,
    description: bookmark.description,
    favicon: bookmark.favicon,
    image: bookmark.image,
    siteName: bookmark.siteName,
    tags: bookmark.tags ?? [],
    groupIds: (bookmark.groupIds ?? []).map(
      (groupId) => new mongoose.Types.ObjectId(String(groupId)),
    ),
    content: bookmark.content,
    publishedDate: bookmark.publishedDate,
    status: bookmark.status,
    class: bookmark.class,
    createdAt: bookmark.createdAt,
    updatedAt: bookmark.updatedAt,
  })) satisfies BookmarkSeedDoc[];

  const idMap = new Map<string, string>();
  const folderByLegacyNoteId = new Map<string, string>();

  for (const folder of folderDocs) {
    for (const noteId of folder.notes) {
      folderByLegacyNoteId.set(String(noteId), String(folder._id));
    }
  }

  const groupSamples: unknown[] = [];
  const noteSamples: unknown[] = [];
  const edgeSamples: unknown[] = [];

  for (const folder of folderDocs) {
    const newGroupId = new mongoose.Types.ObjectId();
    idMap.set(String(folder._id), String(newGroupId));

    const groupDoc = {
      _id: newGroupId,
      name: folder.name,
      parentId: null,
      autoCreated: false,
      createdAt: folder.createdAt,
      updatedAt: folder.updatedAt,
    };

    if (groupSamples.length < 3) {
      groupSamples.push(groupDoc);
    }

    if (!DRY_RUN) {
      await NoteGroup.collection.insertOne(groupDoc);
    }
  }

  for (const folder of folderDocs) {
    const newGroupId = idMap.get(String(folder._id));
    const parentId = folder.parentFolder
      ? (idMap.get(String(folder.parentFolder)) ?? null)
      : null;

    if (!newGroupId || isSelfParent(newGroupId, parentId)) {
      continue;
    }

    if (!DRY_RUN && parentId) {
      await NoteGroup.collection.updateOne(
        { _id: new mongoose.Types.ObjectId(newGroupId) },
        { $set: { parentId: new mongoose.Types.ObjectId(parentId) } },
      );
    }
  }

  for (const group of bookmarkGroupDocs) {
    const newGroupId = new mongoose.Types.ObjectId();
    idMap.set(String(group._id), String(newGroupId));

    const groupDoc = {
      _id: newGroupId,
      name: group.name,
      description: group.description,
      color: group.color,
      parentId: null,
      autoCreated: group.autoCreated,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
    };

    if (groupSamples.length < 6) {
      groupSamples.push(groupDoc);
    }

    if (!DRY_RUN) {
      await NoteGroup.collection.insertOne(groupDoc);
    }
  }

  for (const group of bookmarkGroupDocs) {
    const newGroupId = idMap.get(String(group._id));
    const parentId = group.parentId
      ? (idMap.get(String(group.parentId)) ?? null)
      : null;

    if (!newGroupId || isSelfParent(newGroupId, parentId)) {
      continue;
    }

    if (!DRY_RUN && parentId) {
      await NoteGroup.collection.updateOne(
        { _id: new mongoose.Types.ObjectId(newGroupId) },
        { $set: { parentId: new mongoose.Types.ObjectId(parentId) } },
      );
    }
  }

  const trackingDocs: KnowledgeMigrationNoteTracking[] = [];
  const legacyNoteIdToNewId = new Map<string, string>();

  for (const legacyNote of legacyNoteDocs) {
    const newNoteId = new mongoose.Types.ObjectId();
    const legacyFolderId =
      folderByLegacyNoteId.get(String(legacyNote._id)) ?? null;
    const mappedGroupId = legacyFolderId
      ? (idMap.get(legacyFolderId) ?? null)
      : null;

    const noteDoc = {
      _id: newNoteId,
      title: legacyNote.title,
      content: legacyNote.content,
      tags: [],
      groupIds: mappedGroupId
        ? [new mongoose.Types.ObjectId(mappedGroupId)]
        : [],
      status: "open" as const,
      createdAt: legacyNote.createdAt,
      updatedAt: legacyNote.updatedAt,
    };

    legacyNoteIdToNewId.set(String(legacyNote._id), String(newNoteId));
    idMap.set(String(legacyNote._id), String(newNoteId));

    trackingDocs.push({
      _id: `note:${newNoteId.toString()}`,
      kind: "note-tracking",
      newNoteId: newNoteId.toString(),
      legacyId: String(legacyNote._id),
      source: "legacy-note",
      legacyFolderId,
      categorizedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    if (noteSamples.length < 3) {
      noteSamples.push(noteDoc);
    }

    if (!DRY_RUN) {
      await Note.collection.insertOne(noteDoc);
    }
  }

  for (const bookmark of bookmarkDocs) {
    const newNoteId = new mongoose.Types.ObjectId();
    const mappedGroupIds = (bookmark.groupIds ?? [])
      .map((groupId) => idMap.get(String(groupId)))
      .filter((groupId): groupId is string => Boolean(groupId))
      .map((groupId) => new mongoose.Types.ObjectId(groupId));

    const noteDoc = {
      _id: newNoteId,
      title: bookmark.title,
      content: bookmark.content ?? "",
      url: bookmark.url,
      description: bookmark.description,
      siteName: bookmark.siteName,
      favicon: bookmark.favicon,
      image: bookmark.image,
      publishedDate: bookmark.publishedDate,
      tags: bookmark.tags ?? [],
      groupIds: mappedGroupIds,
      status: bookmark.status,
      class: bookmark.class,
      createdAt: bookmark.createdAt,
      updatedAt: bookmark.updatedAt,
    };

    idMap.set(String(bookmark._id), String(newNoteId));

    trackingDocs.push({
      _id: `note:${newNoteId.toString()}`,
      kind: "note-tracking",
      newNoteId: newNoteId.toString(),
      legacyId: String(bookmark._id),
      source: "legacy-bookmark",
      legacyFolderId: null,
      categorizedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    if (noteSamples.length < 6) {
      noteSamples.push(noteDoc);
    }

    if (!DRY_RUN) {
      await Note.collection.insertOne(noteDoc);
    }
  }

  for (const edge of bookmarkEdges) {
    const from = idMap.get(String(edge.from));
    const to = idMap.get(String(edge.to));
    if (!from || !to) continue;

    const edgeDoc = {
      _id: new mongoose.Types.ObjectId(),
      from: new mongoose.Types.ObjectId(from),
      to: new mongoose.Types.ObjectId(to),
      strength: edge.strength,
      reason: edge.reason,
      createdAt: edge.createdAt,
      updatedAt: edge.updatedAt,
    };

    if (edgeSamples.length < 5) {
      edgeSamples.push(edgeDoc);
    }

    if (!DRY_RUN) {
      await NoteEdge.collection.insertOne(edgeDoc);
    }
  }

  let updatedJournalCount = 0;
  const journals = await JournalLog.find().select("_id notes").lean().exec();
  for (const journal of journals) {
    const nextNoteIds = (journal.notes ?? [])
      .map((noteId) => legacyNoteIdToNewId.get(String(noteId)))
      .filter((noteId): noteId is string => Boolean(noteId))
      .map((noteId) => new mongoose.Types.ObjectId(noteId));

    if (nextNoteIds.length === 0) continue;

    const hasChanged =
      nextNoteIds.length !== (journal.notes ?? []).length ||
      nextNoteIds.some(
        (noteId, index) => String(journal.notes?.[index]) !== String(noteId),
      );

    if (!hasChanged) continue;

    updatedJournalCount += 1;

    if (!DRY_RUN) {
      await JournalLog.updateOne(
        { _id: journal._id },
        { $set: { notes: nextNoteIds } },
      ).exec();
    }
  }

  let updatedKanbanCardCount = 0;
  const cards = await KanbanCard.find({
    description: { $regex: "\\[note\\]\\(" },
  })
    .select("_id description")
    .lean()
    .exec();

  for (const card of cards) {
    const description = card.description ?? "";
    const nextDescription = description.replace(
      /\[note\]\(([^,]+),/g,
      (full, legacyId: string) => {
        const newNoteId = legacyNoteIdToNewId.get(legacyId.trim());
        return newNoteId ? `[note](${newNoteId},` : full;
      },
    );

    if (nextDescription === description) continue;
    updatedKanbanCardCount += 1;

    if (!DRY_RUN) {
      await KanbanCard.updateOne(
        { _id: card._id },
        { $set: { description: nextDescription } },
      ).exec();
    }
  }

  const manifestDoc: KnowledgeMigrationManifest = {
    _id: KNOWLEDGE_MIGRATION_MANIFEST_ID,
    kind: "manifest" as const,
    legacyFolders: folderDocs.map((folder) => ({
      oldId: String(folder._id),
      name: folder.name,
      parentOldId: folder.parentFolder ? String(folder.parentFolder) : null,
    })),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  if (!DRY_RUN) {
    await trackingCollection.insertOne(manifestDoc);
    if (trackingDocs.length > 0) {
      await trackingCollection.insertMany(trackingDocs);
    }
  }

  const expectedNoteCount = legacyNoteDocs.length + bookmarkDocs.length;
  const expectedGroupCount = folderDocs.length + bookmarkGroupDocs.length;
  const expectedEdgeCount = bookmarkEdges.length;

  const actualCounts = DRY_RUN
    ? {
        notes: expectedNoteCount,
        groups: expectedGroupCount,
        edges: expectedEdgeCount,
      }
    : {
        notes: await Note.countDocuments(),
        groups: await NoteGroup.countDocuments(),
        edges: await NoteEdge.countDocuments(),
      };

  console.log("\nVerification:");
  console.log(
    `Note count: ${actualCounts.notes} (expected ${expectedNoteCount})`,
  );
  console.log(
    `NoteGroup count: ${actualCounts.groups} (expected ${expectedGroupCount})`,
  );
  console.log(
    `NoteEdge count: ${actualCounts.edges} (expected ${expectedEdgeCount})`,
  );
  console.log(`Journal docs updated: ${updatedJournalCount}`);
  console.log(`Kanban cards updated: ${updatedKanbanCardCount}`);

  summarizeSamples("Sample NoteGroups", groupSamples);
  summarizeSamples("Sample Notes", noteSamples);
  summarizeSamples("Sample NoteEdges", edgeSamples);

  if (
    actualCounts.notes !== expectedNoteCount ||
    actualCounts.groups !== expectedGroupCount ||
    actualCounts.edges !== expectedEdgeCount
  ) {
    throw new Error(
      "Verification failed. Unified collection counts do not match expectations.",
    );
  }

  if (DRY_RUN) {
    console.log("\nDry run complete. No data was written.");
    return;
  }

  const shouldDropLegacy = await promptYesNo(
    "Verification passed. Drop the legacy collections now?",
  );

  if (!shouldDropLegacy) {
    console.log("Legacy collections were left intact.");
    return;
  }

  for (const collectionName of LEGACY_COLLECTIONS) {
    const collection = db.collection(collectionName);
    const exists = await collection.countDocuments({}, { limit: 1 });
    if (exists >= 0) {
      await collection.drop().catch((error: unknown) => {
        if (
          typeof error === "object" &&
          error &&
          "codeName" in error &&
          error.codeName === "NamespaceNotFound"
        ) {
          return;
        }
        throw error;
      });
    }
  }

  console.log("Legacy collections dropped.");
}

main()
  .then(() => {
    console.log("Knowledge migration finished.");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Knowledge migration failed:", error);
    process.exit(1);
  });
