import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { KnowledgeSemanticSuggestion } from "@/models/KnowledgeSemanticSuggestion";
import { type ILeanNote, Note } from "@/models/Note";
import { type ILeanNoteGroup, NoteGroup } from "@/models/NoteGroup";

const DRAFT_COLLECTION = "knowledge_hierarchy_drafts";
const BACKUP_COLLECTION = "knowledge_hierarchy_apply_backups";

interface DraftNote {
  noteId: string;
  oldTitle: string;
  proposedTitle: string;
  oldPaths: string[];
  proposedPath: string[];
  tags: string[];
  confidence: number;
}

interface HierarchyDraftDocument {
  _id: string;
  kind: "hierarchy-draft";
  status: "pending-review" | "applied" | "superseded";
  model: string;
  embeddingModel: string;
  createdAt: Date;
  stats: {
    notes: number;
    oldGroups: number;
    proposedGroups: number;
    renamedNotes: number;
  };
  groups: Array<{ path: string[] }>;
  notes: DraftNote[];
}

interface HierarchyApplyBackupDocument {
  _id: string;
  kind: "hierarchy-apply-backup";
  draftId: string;
  createdAt: Date;
  notes: ILeanNote[];
  groups: ILeanNoteGroup[];
  draft: HierarchyDraftDocument;
}

function isDryRun() {
  return process.argv.includes("--dry-run");
}

function cleanPath(path: string[]) {
  return path.map((part) => part.trim()).filter(Boolean);
}

function pathKey(path: string[]) {
  return cleanPath(path).join(" > ");
}

async function loadDraft() {
  const db = mongoose.connection.db;
  if (!db) throw new Error("Mongo database connection not available");

  const draftId = process.env.DRAFT_ID;
  const collection = db.collection<HierarchyDraftDocument>(DRAFT_COLLECTION);
  const draft = draftId
    ? await collection.findOne({ _id: draftId })
    : await collection.findOne(
        { kind: "hierarchy-draft", status: "pending-review" },
        { sort: { createdAt: -1 } },
      );

  if (!draft) {
    throw new Error(
      draftId
        ? `Draft ${draftId} not found`
        : "No pending hierarchy draft found",
    );
  }

  if (draft.status !== "pending-review") {
    throw new Error(
      `Draft ${draft._id} is ${draft.status}, not pending-review`,
    );
  }

  return draft;
}

function validateDraft(draft: HierarchyDraftDocument, notes: ILeanNote[]) {
  const noteIds = new Set(notes.map((note) => String(note._id)));
  const seenDraftNotes = new Set<string>();
  const errors: string[] = [];

  for (const note of draft.notes) {
    if (!noteIds.has(note.noteId)) {
      errors.push(`Draft references missing note ${note.noteId}`);
    }

    if (seenDraftNotes.has(note.noteId)) {
      errors.push(`Draft references note ${note.noteId} more than once`);
    }
    seenDraftNotes.add(note.noteId);

    if (cleanPath(note.proposedPath).length === 0) {
      errors.push(`Draft note ${note.noteId} has empty proposedPath`);
    }

    if (!note.proposedTitle.trim()) {
      errors.push(`Draft note ${note.noteId} has empty proposedTitle`);
    }
  }

  for (const note of notes) {
    if (!seenDraftNotes.has(String(note._id))) {
      errors.push(`Current note ${note._id} is missing from draft`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Draft validation failed:\n${errors.join("\n")}`);
  }
}

async function createBackup({
  draft,
  notes,
  groups,
  now,
}: {
  draft: HierarchyDraftDocument;
  notes: ILeanNote[];
  groups: ILeanNoteGroup[];
  now: Date;
}) {
  const db = mongoose.connection.db;
  if (!db) throw new Error("Mongo database connection not available");

  const backup = {
    _id: `hierarchy-apply-backup:${now.toISOString()}`,
    kind: "hierarchy-apply-backup",
    draftId: draft._id,
    createdAt: now,
    notes,
    groups,
    draft,
  } satisfies HierarchyApplyBackupDocument;

  await db
    .collection<HierarchyApplyBackupDocument>(BACKUP_COLLECTION)
    .insertOne(backup);
  return backup._id;
}

async function createGroups(draft: HierarchyDraftDocument) {
  const groupIdByPath = new Map<string, mongoose.Types.ObjectId>();

  const allPaths = new Set<string>();
  for (const group of draft.groups) {
    const path = cleanPath(group.path);
    for (let length = 1; length <= path.length; length += 1) {
      allPaths.add(path.slice(0, length).join(" > "));
    }
  }

  for (const note of draft.notes) {
    const path = cleanPath(note.proposedPath);
    for (let length = 1; length <= path.length; length += 1) {
      allPaths.add(path.slice(0, length).join(" > "));
    }
  }

  const sortedPaths = [...allPaths].sort(
    (left, right) =>
      left.split(" > ").length - right.split(" > ").length ||
      left.localeCompare(right),
  );

  for (const key of sortedPaths) {
    const path = key.split(" > ");
    const parentKey = path.slice(0, -1).join(" > ");
    const parentId = parentKey ? groupIdByPath.get(parentKey) : null;
    const group = await NoteGroup.create({
      name: path.at(-1),
      parentId: parentId ?? null,
      autoCreated: true,
      kind: "generated",
      source: "semantic",
      lockedByUser: false,
      confidence: 0.8,
      aliases: [],
    });

    groupIdByPath.set(key, group._id);
  }

  return groupIdByPath;
}

async function applyDraft(draft: HierarchyDraftDocument) {
  const now = new Date();
  const [notes, groups] = await Promise.all([
    Note.find().sort({ createdAt: 1 }).lean<ILeanNote[]>().exec(),
    NoteGroup.find().sort({ name: 1 }).lean<ILeanNoteGroup[]>().exec(),
  ]);

  validateDraft(draft, notes);

  const proposedGroupKeys = new Set<string>();
  for (const note of draft.notes) {
    proposedGroupKeys.add(pathKey(note.proposedPath));
  }

  if (isDryRun()) {
    return {
      dryRun: true,
      draftId: draft._id,
      notes: notes.length,
      oldGroups: groups.length,
      proposedLeafGroups: proposedGroupKeys.size,
      renamedNotes: draft.notes.filter(
        (note) => note.oldTitle !== note.proposedTitle,
      ).length,
    };
  }

  const backupId = await createBackup({ draft, notes, groups, now });

  await NoteGroup.deleteMany({});
  const groupIdByPath = await createGroups(draft);

  let updatedNotes = 0;
  let renamedNotes = 0;
  for (const note of draft.notes) {
    const groupId = groupIdByPath.get(pathKey(note.proposedPath));
    if (!groupId) {
      throw new Error(`Could not resolve group for ${note.proposedPath}`);
    }

    const title = note.proposedTitle.trim();
    const existingTitle = notes.find(
      (current) => String(current._id) === note.noteId,
    )?.title;
    if (existingTitle !== title) renamedNotes += 1;

    const result = await Note.updateOne(
      { _id: new mongoose.Types.ObjectId(note.noteId) },
      {
        $set: {
          title,
          groupIds: [groupId],
          semanticStatus: "stale",
        },
        $unset: {
          semanticContentHash: "",
          semanticUpdatedAt: "",
          semanticError: "",
        },
      },
    );
    updatedNotes += result.modifiedCount;
  }

  const supersededSuggestions = await KnowledgeSemanticSuggestion.updateMany(
    { status: "pending" },
    { $set: { status: "superseded", decidedAt: now } },
  );

  const db = mongoose.connection.db;
  if (!db) throw new Error("Mongo database connection not available");
  await db.collection<HierarchyDraftDocument>(DRAFT_COLLECTION).updateOne(
    { _id: draft._id },
    {
      $set: {
        status: "applied",
        appliedAt: now,
        backupId,
      },
    },
  );

  return {
    dryRun: false,
    draftId: draft._id,
    backupId,
    deletedGroups: groups.length,
    createdGroups: groupIdByPath.size,
    updatedNotes,
    renamedNotes,
    supersededSuggestions: supersededSuggestions.modifiedCount,
  };
}

async function main() {
  await connectDB();
  const draft = await loadDraft();
  const result = await applyDraft(draft);
  console.log(JSON.stringify(result, null, 2));
}

main()
  .then(async () => {
    await mongoose.disconnect();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("Hierarchy draft apply failed:", error);
    await mongoose.disconnect();
    process.exit(1);
  });
