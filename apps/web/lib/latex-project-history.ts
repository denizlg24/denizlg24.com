import "server-only";

import type {
  ILatexProjectRecord,
  LatexProjectChangedFile,
  LatexProjectHistoryAction,
  LatexProjectHistoryDetail,
  LatexProjectHistorySummary,
} from "@repo/schemas";
import mongoose from "mongoose";
import {
  changedLatexFiles,
  mergeLatexChangedFiles,
} from "@/lib/latex-project-history-core";
import { connectDB } from "@/lib/mongodb";
import { LatexProjectRevision } from "@/models/LatexProjectRevision";

const EDIT_COALESCE_MS = 30_000;

function validId(value: string): boolean {
  return mongoose.Types.ObjectId.isValid(value);
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}

function serializeSummary(value: {
  _id: unknown;
  projectId: unknown;
  revision: number;
  name: string;
  action: LatexProjectHistoryAction;
  compileCount: number;
  changedFiles?: LatexProjectChangedFile[];
  createdAt: Date;
  updatedAt: Date;
}): LatexProjectHistorySummary {
  return {
    _id: String(value._id),
    projectId: String(value.projectId),
    revision: value.revision,
    name: value.name,
    action: value.action,
    compileCount: value.compileCount,
    changedFiles: value.changedFiles ?? [],
    createdAt: new Date(value.createdAt).toISOString(),
    updatedAt: new Date(value.updatedAt).toISOString(),
  };
}

export async function recordLatexProjectSnapshot(
  record: ILatexProjectRecord,
  action: LatexProjectHistoryAction,
): Promise<void> {
  await connectDB();
  const projectId = new mongoose.Types.ObjectId(record._id);
  const latest = await LatexProjectRevision.findOne({ projectId })
    .sort({ updatedAt: -1 })
    .lean()
    .exec();
  const changedFiles = changedLatexFiles(
    latest?.project ?? null,
    record.project,
  );
  const nameChanged = latest ? latest.name !== record.name : true;
  if (
    latest &&
    changedFiles.length === 0 &&
    !nameChanged &&
    latest.revision === record.revision
  ) {
    return;
  }

  const now = new Date();
  const canCoalesce =
    action === "edit" &&
    latest?.action === "edit" &&
    now.getTime() - new Date(latest.createdAt).getTime() < EDIT_COALESCE_MS;
  if (canCoalesce && latest) {
    await LatexProjectRevision.updateOne(
      { _id: latest._id },
      {
        $set: {
          revision: record.revision,
          name: record.name,
          compileCount: record.compileCount,
          project: record.project,
          changedFiles: mergeLatexChangedFiles(
            latest.changedFiles ?? [],
            changedFiles,
          ),
          updatedAt: now,
        },
      },
    ).exec();
    return;
  }

  const initialTimestamp =
    !latest && action === "create" ? new Date(record.createdAt) : null;
  try {
    await LatexProjectRevision.create({
      projectId,
      revision: record.revision,
      name: record.name,
      action,
      compileCount: record.compileCount,
      changedFiles,
      project: record.project,
      ...(initialTimestamp
        ? { createdAt: initialTimestamp, updatedAt: initialTimestamp }
        : {}),
    });
  } catch (error) {
    if (action === "create" && isDuplicateKeyError(error)) return;
    throw error;
  }
}

export async function listLatexProjectHistory(
  projectId: string,
  limit = 100,
): Promise<LatexProjectHistorySummary[]> {
  await connectDB();
  if (!validId(projectId)) return [];
  const revisions = await LatexProjectRevision.find({ projectId })
    .sort({ updatedAt: -1 })
    .limit(Math.min(200, Math.max(1, limit)))
    .lean()
    .exec();
  return revisions.map(serializeSummary);
}

export async function getLatexProjectHistoryRevision(
  projectId: string,
  snapshotId: string,
): Promise<LatexProjectHistoryDetail | null> {
  await connectDB();
  if (!validId(projectId) || !validId(snapshotId)) return null;
  const revision = await LatexProjectRevision.findOne({
    _id: snapshotId,
    projectId,
  })
    .lean()
    .exec();
  return revision
    ? { ...serializeSummary(revision), project: revision.project }
    : null;
}

export async function deleteLatexProjectHistory(
  projectId: string,
): Promise<void> {
  await connectDB();
  if (!validId(projectId)) return;
  await LatexProjectRevision.deleteMany({ projectId }).exec();
}
