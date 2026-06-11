export const KNOWLEDGE_MIGRATION_COLLECTION = "knowledge_migration_tracking";
export const KNOWLEDGE_MIGRATION_MANIFEST_ID = "knowledge-migration-manifest";

export interface LegacyFolderSeed {
  oldId: string;
  name: string;
  parentOldId: string | null;
}

export interface KnowledgeMigrationManifest {
  _id: typeof KNOWLEDGE_MIGRATION_MANIFEST_ID;
  kind: "manifest";
  legacyFolders: LegacyFolderSeed[];
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeMigrationNoteTracking {
  _id: string;
  kind: "note-tracking";
  newNoteId: string;
  legacyId: string;
  source: "legacy-note" | "legacy-bookmark";
  legacyFolderId?: string | null;
  categorizedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type KnowledgeMigrationTrackingDocument =
  | KnowledgeMigrationManifest
  | KnowledgeMigrationNoteTracking;
