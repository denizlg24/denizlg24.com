import {
  compileLatexProjectRequestSchema,
  type ILatexProjectRecord,
} from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import {
  compileLatexProject,
  LatexCompilationError,
  tryAcquireLatexCompileLock,
} from "@/lib/latex-compiler";
import {
  latexProjectErrorResponse,
  safeDownloadName,
} from "@/lib/latex-project-route";
import {
  beginLatexProjectCompilation,
  failLatexProjectCompilation,
  finishLatexProjectCompilation,
  getLatexProject,
} from "@/lib/latex-projects";
import { isCrossOriginCookieRequest } from "@/lib/request-security";
import { requireAdmin } from "@/lib/require-admin";
import { deleteFileFromStorage, uploadFileToStorage } from "@/lib/storage-api";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  if (isCrossOriginCookieRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  // The validated source is capped at 4MB; JSON escaping can make the wire
  // representation significantly larger than the source itself.
  if (declaredLength > 10 * 1024 * 1024) {
    return NextResponse.json(
      { error: "Request is too large" },
      { status: 413 },
    );
  }
  const parsed = compileLatexProjectRequestSchema.safeParse(
    await request.json(),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid LaTeX project", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { projectId } = await context.params;
  const release = tryAcquireLatexCompileLock(`project:${projectId}`);
  if (!release) {
    return NextResponse.json(
      { error: "This project is already compiling" },
      { status: 409 },
    );
  }

  let revision: number | null = null;
  try {
    const lease = await beginLatexProjectCompilation(
      projectId,
      parsed.data.baseRevision,
      parsed.data.project,
    );
    revision = lease.project.revision;
    let compilation: Awaited<ReturnType<typeof compileLatexProject>>;
    try {
      compilation = await compileLatexProject(lease.project.project);
    } catch (error) {
      const message =
        error instanceof LatexCompilationError
          ? `${error.message}\n${error.log}`.trim()
          : error instanceof Error
            ? error.message
            : "Compilation failed";
      await failLatexProjectCompilation(projectId, revision, message);
      if (error instanceof LatexCompilationError) {
        const failedProject = await getLatexProject(projectId);
        return NextResponse.json(
          { error: error.message, log: error.log, project: failedProject },
          { status: 422 },
        );
      }
      throw error;
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
    return NextResponse.json({ project, log: compilation.log });
  } catch (error) {
    const handled = latexProjectErrorResponse(error);
    if (handled) return handled;
    if (revision !== null) {
      await failLatexProjectCompilation(
        projectId,
        revision,
        error instanceof Error ? error.message : "Compilation failed",
      ).catch(() => undefined);
    }
    console.error("LaTeX project compilation failed", error);
    return NextResponse.json(
      { error: "Failed to compile LaTeX project" },
      { status: 500 },
    );
  } finally {
    release();
  }
}
