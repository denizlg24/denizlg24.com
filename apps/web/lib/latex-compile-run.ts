import type { ILatexProject, ILatexProjectRecord } from "@repo/schemas";
import {
  compileLatexProject,
  LatexCompilationError,
  tryAcquireLatexCompileLock,
} from "@/lib/latex-compiler";
import { safeDownloadName } from "@/lib/latex-project-route";
import {
  beginLatexProjectCompilation,
  failLatexProjectCompilation,
  finishLatexProjectCompilation,
  getLatexProject,
} from "@/lib/latex-projects";
import { deleteFileFromStorage, uploadFileToStorage } from "@/lib/storage-api";

// The compile pipeline — lock, lease, Tectonic, upload, stale-PDF cleanup — is
// shared by the compile route and the chat tool. Duplicating it would mean two
// places that can leak an uploaded PDF or strand a compilation lease.

export class LatexCompileBusyError extends Error {
  constructor() {
    super("This project is already compiling");
  }
}

/** Tectonic rejected the source; the project row records the failure. */
export class LatexCompileFailedError extends Error {
  constructor(
    message: string,
    readonly log: string,
    readonly project: ILatexProjectRecord,
  ) {
    super(message);
  }
}

export async function runLatexProjectCompilation(options: {
  projectId: string;
  baseRevision: number;
  project: ILatexProject;
}): Promise<{ project: ILatexProjectRecord; log: string }> {
  const { projectId } = options;
  const release = tryAcquireLatexCompileLock(`project:${projectId}`);
  if (!release) throw new LatexCompileBusyError();

  let revision: number | null = null;
  try {
    const lease = await beginLatexProjectCompilation(
      projectId,
      options.baseRevision,
      options.project,
    );
    revision = lease.project.revision;

    let compilation: Awaited<ReturnType<typeof compileLatexProject>>;
    try {
      compilation = await compileLatexProject(lease.project.project);
    } catch (error) {
      // Only Tectonic failures are recorded here; anything else falls through
      // to the outer catch, which records it once with the same message.
      if (!(error instanceof LatexCompilationError)) throw error;
      await failLatexProjectCompilation(
        projectId,
        revision,
        `${error.message}\n${error.log}`.trim(),
      ).catch((failError) =>
        console.error("Failed to record LaTeX compile failure", failError),
      );
      throw new LatexCompileFailedError(
        error.message,
        error.log,
        await getLatexProject(projectId),
      );
    }

    const base = safeDownloadName(lease.project.name, "latex-project");
    const filename = `${base}.pdf`;
    const file = new File([new Uint8Array(compilation.pdf)], filename, {
      type: "application/pdf",
    });
    const uploaded = await uploadFileToStorage(file, "file");

    let project: ILatexProjectRecord;
    try {
      project = await finishLatexProjectCompilation(projectId, revision, {
        storageKey: uploaded.id,
        filename,
        size: uploaded.sizeBytes,
        revision,
        updatedAt: new Date(),
      });
    } catch (error) {
      await deleteFileFromStorage(uploaded.id).catch(() => undefined);
      throw error;
    }

    const staleKey = lease.previousPdf?.storageKey;
    if (staleKey && staleKey !== uploaded.id) {
      await deleteFileFromStorage(staleKey).catch((error) =>
        console.error("Failed to remove stale LaTeX PDF", error),
      );
    }
    return { project, log: compilation.log };
  } catch (error) {
    if (revision !== null && !(error instanceof LatexCompileFailedError)) {
      await failLatexProjectCompilation(
        projectId,
        revision,
        error instanceof Error ? error.message : "Compilation failed",
      ).catch(() => undefined);
    }
    throw error;
  } finally {
    release();
  }
}
