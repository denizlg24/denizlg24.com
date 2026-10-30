import { legacyBlockSchema } from "@repo/schemas";
import { z } from "zod";
import { DesktopWorkspace } from "@/models/DesktopWorkspace";
import {
  type IWorkspacePage,
  WorkspacePageModel,
} from "@/models/WorkspacePage";
import {
  type IWorkspacePageRevision,
  WorkspacePageRevisionModel,
} from "@/models/WorkspacePageRevision";
import {
  type IWorkspacePrefs,
  WorkspacePrefsModel,
} from "@/models/WorkspacePrefs";
import type {
  StoredPage,
  StoredPrefs,
  StoredRevision,
  WorkspaceRepo,
} from "./repo";

const PREFS_ID = "singleton";
const LEGACY_ID = "singleton";
const DUPLICATE_KEY = 11000;

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === DUPLICATE_KEY
  );
}

/**
 * A page whose `blocks` still hold v1 grid blocks (written before
 * `legacyBlocks` existed) reads as one awaiting migration.
 */
function toStoredPage(doc: IWorkspacePage): StoredPage {
  const { _id, template, ...fields } = doc;
  const rest = template ? { ...fields, template } : fields;
  const legacy = rest.legacyBlocks ?? null;
  if (!legacy && rest.blocks.some((block) => "span" in block)) {
    const parsed = z.array(legacyBlockSchema).safeParse(rest.blocks);
    if (parsed.success) {
      return { ...rest, id: _id, blocks: [], legacyBlocks: parsed.data };
    }
  }
  return { ...rest, id: _id, legacyBlocks: legacy };
}

function toDoc(page: StoredPage): IWorkspacePage {
  const { id, ...rest } = page;
  return { ...rest, _id: id };
}

function toStoredRevision(doc: IWorkspacePageRevision): StoredRevision {
  return {
    pageId: doc.pageId,
    rev: doc.rev,
    actor: doc.actor,
    via: doc.via,
    kind: doc.kind,
    at: doc.at,
    ops: doc.ops,
    inverse: doc.inverse,
    touched: doc.touched,
    snapshot: doc.snapshot,
    legacy: doc.legacy ?? null,
  };
}

function toStoredPrefs(doc: IWorkspacePrefs): StoredPrefs {
  const { _id, ...rest } = doc;
  return rest;
}

export const mongoWorkspaceRepo: WorkspaceRepo = {
  async getPage(id) {
    const doc = await WorkspacePageModel.findById(id)
      .lean<IWorkspacePage>()
      .exec();
    return doc ? toStoredPage(doc) : null;
  },

  async listPages() {
    const docs = await WorkspacePageModel.find({ purgedAt: null })
      .lean<IWorkspacePage[]>()
      .exec();
    return docs.map(toStoredPage);
  },

  async pagesChangedSince(since) {
    const docs = await WorkspacePageModel.find({ changedAt: { $gte: since } })
      .lean<IWorkspacePage[]>()
      .exec();
    return docs.map(toStoredPage);
  },

  async insertPage(page) {
    const { _id, ...fields } = toDoc(page);
    const result = await WorkspacePageModel.updateOne(
      { _id },
      { $setOnInsert: fields },
      { upsert: true },
    ).exec();
    return result.upsertedCount > 0;
  },

  async replacePage(expectedRev, page) {
    const { _id, compatBase: _base, template, ...fields } = toDoc(page);
    const result = await WorkspacePageModel.updateOne(
      { _id, rev: expectedRev },
      template
        ? { $set: { ...fields, template } }
        : { $set: fields, $unset: { template: 1 } },
    ).exec();
    return result.matchedCount > 0;
  },

  async setCompatBase(id, base) {
    await WorkspacePageModel.updateOne(
      { _id: id },
      { $set: { compatBase: base } },
    ).exec();
  },

  async insertRevision(revision) {
    try {
      await WorkspacePageRevisionModel.updateOne(
        { pageId: revision.pageId, rev: revision.rev },
        { $setOnInsert: revision },
        { upsert: true },
      ).exec();
    } catch (error) {
      // Two migrations racing on the same (pageId, rev): the other one won.
      if (!isDuplicateKey(error)) throw error;
    }
  },

  async revisionsAfter(pageId, after, upTo) {
    const docs = await WorkspacePageRevisionModel.find({
      pageId,
      rev: upTo === undefined ? { $gt: after } : { $gt: after, $lte: upTo },
    })
      .sort({ rev: 1 })
      .lean<IWorkspacePageRevision[]>()
      .exec();
    return docs.map(toStoredRevision);
  },

  async latestSnapshot(pageId, atOrBefore) {
    const doc = await WorkspacePageRevisionModel.findOne({
      pageId,
      rev: { $lte: atOrBefore },
      snapshot: { $ne: null },
    })
      .sort({ rev: -1 })
      .lean<IWorkspacePageRevision>()
      .exec();
    return doc ? toStoredRevision(doc) : null;
  },

  async listRevisions(pageId, { limit, before }) {
    const docs = await WorkspacePageRevisionModel.find({
      pageId,
      ...(before === undefined ? {} : { rev: { $lt: before } }),
    })
      .sort({ rev: -1 })
      .limit(limit)
      .lean<IWorkspacePageRevision[]>()
      .exec();
    return docs.map(toStoredRevision);
  },

  async deleteRevisions(pageId) {
    await WorkspacePageRevisionModel.deleteMany({ pageId }).exec();
  },

  async getPrefs() {
    const doc = await WorkspacePrefsModel.findById(PREFS_ID)
      .lean<IWorkspacePrefs>()
      .exec();
    return doc ? toStoredPrefs(doc) : null;
  },

  async insertPrefs(prefs) {
    const result = await WorkspacePrefsModel.updateOne(
      { _id: PREFS_ID },
      { $setOnInsert: prefs },
      { upsert: true },
    ).exec();
    return result.upsertedCount > 0;
  },

  async savePrefs(prefs) {
    const { compatBase: _base, ...fields } = prefs;
    await WorkspacePrefsModel.updateOne(
      { _id: PREFS_ID },
      { $set: fields },
    ).exec();
  },

  async setPrefsCompatBase(base) {
    await WorkspacePrefsModel.updateOne(
      { _id: PREFS_ID },
      { $set: { compatBase: base } },
    ).exec();
  },

  async loadLegacy() {
    const doc = await DesktopWorkspace.findById(LEGACY_ID).lean().exec();
    return doc?.data ?? null;
  },
};
