import type { ICvFile, ILatexProject } from "@repo/schemas";
import { revalidatePath } from "next/cache";
import {
  compileLatexProject,
  tryAcquireLatexCompileLock,
} from "@/lib/latex-compiler";
import { connectDB } from "@/lib/mongodb";
import { deleteFileFromStorage, uploadFileToStorage } from "@/lib/storage-api";
import {
  AppSettings,
  type ILeanAppSettings,
  type IStoredCv,
} from "@/models/AppSettings";

/**
 * The CV pipeline: a LaTeX project is saved as source, compiled into a *draft*
 * PDF, and only published when the draft is accepted. The two-stage shape is
 * the point — compiling does not change what denizlg24.com serves, publishing
 * does.
 *
 * Shared by the routes and the agent tools so a CV compiled by either goes
 * through the same lock, the same storage cleanup and the same revalidation.
 */

export class CvCompileBusyError extends Error {
  constructor() {
    super("A compilation is already running");
    this.name = "CvCompileBusyError";
  }
}

export class NoCvDraftError extends Error {
  constructor() {
    super("No compiled draft to publish");
    this.name = "NoCvDraftError";
  }
}

export function serializeCv(cv: IStoredCv | null | undefined): ICvFile | null {
  if (!cv) return null;
  return {
    url: cv.url,
    filename: cv.filename,
    size: cv.size,
    updatedAt: new Date(cv.updatedAt).toISOString(),
  };
}

export async function getCvState() {
  await connectDB();
  const settings = await AppSettings.findById("singleton")
    .lean<ILeanAppSettings>()
    .exec();
  return {
    cv: serializeCv(settings?.cv),
    draft: serializeCv(settings?.cvDraft),
    project: settings?.cvProject ?? null,
  };
}

export async function saveCvProject(project: ILatexProject) {
  await connectDB();
  const settings = await AppSettings.findByIdAndUpdate(
    "singleton",
    { $set: { cvProject: project } },
    { upsert: true, returnDocument: "after" },
  )
    .lean<ILeanAppSettings>()
    .exec();
  return {
    cv: serializeCv(settings?.cv),
    draft: serializeCv(settings?.cvDraft),
    project,
  };
}

/**
 * Compiles the project into a draft PDF. Throws `LatexCompilationError` with
 * the log when the source does not build, which the caller reports rather than
 * treating as a server fault — a LaTeX error is an answer, not a failure.
 */
export async function compileCvProject(project: ILatexProject) {
  const releaseCompileLock = tryAcquireLatexCompileLock("cv");
  if (!releaseCompileLock) throw new CvCompileBusyError();

  try {
    await connectDB();
    const previous = await AppSettings.findById("singleton")
      .lean<ILeanAppSettings>()
      .exec();

    // Source is saved before the compile so a failing build still leaves the
    // edited source behind to fix, rather than discarding it.
    await AppSettings.findByIdAndUpdate(
      "singleton",
      { $set: { cvProject: project } },
      { upsert: true },
    ).exec();

    const compilation = await compileLatexProject(project);
    const filename = "DenizGunesCV.pdf";
    const file = new File([new Uint8Array(compilation.pdf)], filename, {
      type: "application/pdf",
    });
    const uploaded = await uploadFileToStorage(file, "file");

    let settings: ILeanAppSettings | null;
    try {
      settings = await AppSettings.findByIdAndUpdate(
        "singleton",
        {
          $set: {
            cvProject: project,
            cvDraft: {
              url: uploaded.publicUrl,
              filename,
              size: uploaded.sizeBytes,
              storageKey: uploaded.id,
              updatedAt: new Date(),
            },
          },
        },
        { upsert: true, returnDocument: "after" },
      )
        .lean<ILeanAppSettings>()
        .exec();
    } catch (error) {
      await deleteFileFromStorage(uploaded.id).catch(() => undefined);
      throw error;
    }

    if (!settings?.cvDraft) {
      await deleteFileFromStorage(uploaded.id).catch(() => undefined);
      throw new Error("CV draft metadata was not persisted");
    }

    // Drop the superseded draft object, but never the currently published one.
    const staleDraftKey = previous?.cvDraft?.storageKey;
    if (
      staleDraftKey &&
      staleDraftKey !== uploaded.id &&
      staleDraftKey !== previous?.cv?.storageKey
    ) {
      await deleteFileFromStorage(staleDraftKey).catch((error) => {
        console.error("Failed to remove previous CV draft", error);
      });
    }

    return {
      cv: serializeCv(settings.cv),
      draft: serializeCv(settings.cvDraft),
      project,
      log: compilation.log,
    };
  } finally {
    releaseCompileLock();
  }
}

/**
 * Promotes the compiled draft to the published CV and revalidates the public
 * page. This is what changes what visitors download.
 */
export async function publishCvDraft() {
  await connectDB();
  const previous = await AppSettings.findById("singleton")
    .lean<ILeanAppSettings>()
    .exec();

  const draft = previous?.cvDraft;
  if (!draft) throw new NoCvDraftError();

  const settings = await AppSettings.findByIdAndUpdate(
    "singleton",
    {
      $set: {
        cv: {
          url: draft.url,
          filename: draft.filename,
          size: draft.size,
          storageKey: draft.storageKey,
          updatedAt: new Date(),
        },
        cvDraft: null,
      },
    },
    { upsert: true, returnDocument: "after" },
  )
    .lean<ILeanAppSettings>()
    .exec();

  if (!settings?.cv) {
    throw new Error("Published CV metadata was not persisted");
  }
  if (previous?.cv?.storageKey && previous.cv.storageKey !== draft.storageKey) {
    await deleteFileFromStorage(previous.cv.storageKey).catch((error) => {
      console.error("Failed to remove previous published CV", error);
    });
  }

  revalidatePath("/");
  return {
    cv: serializeCv(settings.cv),
    draft: null,
    project: settings.cvProject ?? null,
  };
}
