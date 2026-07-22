import "server-only";

import type {
  CreateLatexProjectInput,
  ILatexProject,
  ILatexProjectRecord,
  LatexProjectSettings,
  LatexProjectSummary,
  UpdateLatexProjectInput,
} from "@repo/schemas";
import mongoose from "mongoose";
import {
  deleteLatexProjectHistory,
  recordLatexProjectSnapshot,
} from "@/lib/latex-project-history";
import { connectDB } from "@/lib/mongodb";
import {
  type ILeanLatexProject,
  type IStoredLatexPdf,
  LatexProject,
} from "@/models/LatexProject";

export class LatexProjectNotFoundError extends Error {
  constructor() {
    super("LaTeX project not found");
    this.name = "LatexProjectNotFoundError";
  }
}

export class LatexProjectRevisionConflictError extends Error {
  constructor(public readonly current: ILatexProjectRecord) {
    super("The project changed on another client");
    this.name = "LatexProjectRevisionConflictError";
  }
}

async function recordSnapshotSafely(
  record: ILatexProjectRecord,
  action: "create" | "edit" | "rename" | "restore",
) {
  try {
    await recordLatexProjectSnapshot(record, action);
  } catch (error) {
    console.error("Failed to record LaTeX project history", error);
  }
}

function validProjectId(id: string): boolean {
  return mongoose.Types.ObjectId.isValid(id);
}

function serializeDate(value: Date | string | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null;
}

function defaultSettings(
  value: Partial<LatexProjectSettings> | null | undefined,
): LatexProjectSettings {
  return {
    grammarDialect: value?.grammarDialect ?? "american",
    bibliographyFile: value?.bibliographyFile ?? null,
    inlineCompletionEnabled: value?.inlineCompletionEnabled ?? true,
    inlineCompletionModel: value?.inlineCompletionModel ?? null,
    agentProvider: value?.agentProvider ?? "hosted",
    agentModel: value?.agentModel ?? null,
    embeddingProvider: value?.embeddingProvider ?? "hosted",
    embeddingModel: value?.embeddingModel ?? null,
    agentMemoryMode: value?.agentMemoryMode ?? "enabled",
  };
}

export function serializeLatexProject(
  value: ILeanLatexProject,
): ILatexProjectRecord {
  return {
    _id: String(value._id),
    name: value.name,
    project: value.project,
    revision: value.revision,
    compileCount: value.compileCount ?? (value.compiledPdf ? 1 : 0),
    archivedAt: serializeDate(value.archivedAt),
    compileStatus: value.compileStatus,
    compileError: value.compileError ?? null,
    compiledPdf: value.compiledPdf
      ? {
          filename: value.compiledPdf.filename,
          size: value.compiledPdf.size,
          revision: value.compiledPdf.revision,
          updatedAt: new Date(value.compiledPdf.updatedAt).toISOString(),
        }
      : null,
    settings: defaultSettings(value.settings),
    ingestion: {
      status: value.ingestion?.status ?? "idle",
      updatedAt: serializeDate(value.ingestion?.updatedAt),
      error: value.ingestion?.error ?? null,
    },
    conversationId: value.conversationId ? String(value.conversationId) : null,
    createdAt: new Date(value.createdAt).toISOString(),
    updatedAt: new Date(value.updatedAt).toISOString(),
  };
}

function serializeSummary(value: ILeanLatexProject): LatexProjectSummary {
  const {
    project: _project,
    compileError: _compileError,
    ...summary
  } = serializeLatexProject(value);
  return summary;
}

async function currentOrThrow(id: string): Promise<ILeanLatexProject> {
  if (!validProjectId(id)) throw new LatexProjectNotFoundError();
  const current = await LatexProject.collection.findOne({
    _id: new mongoose.Types.ObjectId(id),
  });
  if (!current) throw new LatexProjectNotFoundError();
  return current as unknown as ILeanLatexProject;
}

export async function listLatexProjects(options?: {
  includeArchived?: boolean;
}): Promise<LatexProjectSummary[]> {
  await connectDB();
  const filter = options?.includeArchived ? {} : { archivedAt: null };
  const projects = await LatexProject.collection
    .find(filter)
    .sort({ updatedAt: -1 })
    .toArray();
  return projects.map((project) =>
    serializeSummary(project as unknown as ILeanLatexProject),
  );
}

export async function getLatexProject(
  id: string,
): Promise<ILatexProjectRecord> {
  await connectDB();
  return serializeLatexProject(await currentOrThrow(id));
}

export async function createLatexProject(
  input: CreateLatexProjectInput,
): Promise<ILatexProjectRecord> {
  await connectDB();
  const source = { ...input.project, name: input.name };
  const now = new Date();
  const created = {
    _id: new mongoose.Types.ObjectId(),
    name: input.name,
    project: source,
    revision: 0,
    compileCount: 0,
    archivedAt: null,
    compileStatus: "never",
    compileError: null,
    compiledPdf: null,
    settings: defaultSettings(input.settings),
    ingestion: { status: "idle", updatedAt: null, error: null },
    conversationId: null,
    createdAt: now,
    updatedAt: now,
  };
  await LatexProject.collection.insertOne(created);
  const record = serializeLatexProject(created as unknown as ILeanLatexProject);
  await recordSnapshotSafely(record, "create");
  return record;
}

export async function updateLatexProject(
  id: string,
  input: UpdateLatexProjectInput,
  options?: { historyAction?: "edit" | "rename" | "restore" },
): Promise<ILatexProjectRecord> {
  await connectDB();
  const current = await currentOrThrow(id);
  if (current.revision !== input.baseRevision) {
    throw new LatexProjectRevisionConflictError(serializeLatexProject(current));
  }

  const set: Record<string, unknown> = {};
  const name = input.name ?? current.name;
  if (input.name !== undefined) set.name = name;
  if (input.project !== undefined) {
    set.project = { ...input.project, name };
    set.compileStatus = current.compiledPdf ? "stale" : "never";
    set.compileError = null;
  } else if (input.name !== undefined) {
    set.project = { ...current.project, name };
  }
  if (input.archived !== undefined) {
    set.archivedAt = input.archived ? new Date() : null;
  }
  if (input.settings !== undefined) {
    for (const [key, value] of Object.entries(input.settings)) {
      set[`settings.${key}`] = value;
    }
  }
  if (input.conversationId !== undefined) {
    set.conversationId = input.conversationId
      ? new mongoose.Types.ObjectId(input.conversationId)
      : null;
  }

  // Use the driver collection so settings added during a Next.js dev session
  // are not discarded by a previously compiled Mongoose model. This also
  // avoids the deprecated `new: true` option and returns the actual persisted
  // document for immediate client reconciliation.
  const updated = await LatexProject.collection.findOneAndUpdate(
    {
      _id: new mongoose.Types.ObjectId(id),
      revision: input.baseRevision,
    },
    { $set: set, $inc: { revision: 1 } },
    { returnDocument: "after" },
  );
  if (updated) {
    const record = serializeLatexProject(
      updated as unknown as ILeanLatexProject,
    );
    if (input.project !== undefined || input.name !== undefined) {
      await recordSnapshotSafely(
        record,
        options?.historyAction ??
          (input.project !== undefined ? "edit" : "rename"),
      );
    }
    return record;
  }
  const latest = await currentOrThrow(id);
  throw new LatexProjectRevisionConflictError(serializeLatexProject(latest));
}

export async function duplicateLatexProject(
  id: string,
): Promise<ILatexProjectRecord> {
  await connectDB();
  const source = await currentOrThrow(id);
  return createLatexProject({
    name: `${source.name} copy`.slice(0, 100),
    project: {
      ...source.project,
      name: `${source.name} copy`.slice(0, 100),
      entries: source.project.entries.map((entry) => ({
        ...entry,
        id: crypto.randomUUID(),
      })),
    },
    settings: source.settings,
  });
}

export async function deleteLatexProject(
  id: string,
): Promise<{ compiledPdf: IStoredLatexPdf | null }> {
  await connectDB();
  if (!validProjectId(id)) throw new LatexProjectNotFoundError();
  const deleted = await LatexProject.findByIdAndDelete(id)
    .lean<ILeanLatexProject>()
    .exec();
  if (!deleted) throw new LatexProjectNotFoundError();
  await deleteLatexProjectHistory(id).catch((error) =>
    console.error("Failed to remove LaTeX project history", error),
  );
  return { compiledPdf: deleted.compiledPdf ?? null };
}

export interface CompilationLease {
  project: ILatexProjectRecord;
  previousPdf: IStoredLatexPdf | null;
}

export async function beginLatexProjectCompilation(
  id: string,
  baseRevision: number,
  source: ILatexProject,
): Promise<CompilationLease> {
  await connectDB();
  const current = await currentOrThrow(id);
  if (current.revision !== baseRevision) {
    throw new LatexProjectRevisionConflictError(serializeLatexProject(current));
  }
  const updated = await LatexProject.collection.findOneAndUpdate(
    { _id: new mongoose.Types.ObjectId(id), revision: baseRevision },
    {
      $set: {
        project: { ...source, name: current.name },
        compileCount: current.compileCount ?? (current.compiledPdf ? 1 : 0),
        compileStatus: "compiling",
        compileError: null,
      },
      $inc: { revision: 1 },
    },
    { returnDocument: "after" },
  );
  if (!updated) {
    const latest = await currentOrThrow(id);
    throw new LatexProjectRevisionConflictError(serializeLatexProject(latest));
  }
  if (JSON.stringify(current.project) !== JSON.stringify(source)) {
    await recordSnapshotSafely(
      serializeLatexProject(updated as unknown as ILeanLatexProject),
      "edit",
    );
  }
  return {
    project: serializeLatexProject(updated as unknown as ILeanLatexProject),
    previousPdf: current.compiledPdf ?? null,
  };
}

export async function finishLatexProjectCompilation(
  id: string,
  revision: number,
  pdf: IStoredLatexPdf,
): Promise<ILatexProjectRecord> {
  const updated = await LatexProject.collection.findOneAndUpdate(
    { _id: new mongoose.Types.ObjectId(id), revision },
    {
      $set: {
        compiledPdf: pdf,
        compileStatus: "ready",
        compileError: null,
      },
      $inc: { compileCount: 1 },
    },
    { returnDocument: "after" },
  );
  if (!updated) {
    const latest = await currentOrThrow(id);
    throw new LatexProjectRevisionConflictError(serializeLatexProject(latest));
  }
  return serializeLatexProject(updated as unknown as ILeanLatexProject);
}

export async function failLatexProjectCompilation(
  id: string,
  revision: number,
  message: string,
): Promise<void> {
  await LatexProject.updateOne(
    { _id: id, revision },
    {
      $set: {
        compileStatus: "error",
        compileError: message.slice(0, 20_000),
      },
    },
  ).exec();
}

export async function getLatexProjectDownload(
  id: string,
): Promise<{ project: ILatexProjectRecord; storageKey: string | null }> {
  await connectDB();
  const value = await currentOrThrow(id);
  return {
    project: serializeLatexProject(value),
    storageKey: value.compiledPdf?.storageKey ?? null,
  };
}
