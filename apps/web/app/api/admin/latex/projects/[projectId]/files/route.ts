import { latexFileWriteSchema, latexProjectPathSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import {
  deleteLatexFile,
  LatexFileError,
  readLatexFile,
  writeLatexFile,
} from "@/lib/latex-project-files";
import { latexProjectErrorResponse } from "@/lib/latex-project-route";
import { isCrossOriginCookieRequest } from "@/lib/request-security";
import { requireAdmin } from "@/lib/require-admin";

export const runtime = "nodejs";

type Context = { params: Promise<{ projectId: string }> };

function failure(error: unknown, label: string) {
  if (error instanceof LatexFileError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  }
  const handled = latexProjectErrorResponse(error);
  if (handled) return handled;
  console.error(`Failed to ${label} LaTeX file`, error);
  return NextResponse.json(
    { error: `Failed to ${label} LaTeX file` },
    { status: 500 },
  );
}

function pathFrom(request: NextRequest) {
  return latexProjectPathSchema.safeParse(
    request.nextUrl.searchParams.get("path"),
  );
}

export async function GET(request: NextRequest, context: Context) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const path = pathFrom(request);
  if (!path.success) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }
  try {
    const { projectId } = await context.params;
    return NextResponse.json(await readLatexFile(projectId, path.data));
  } catch (error) {
    return failure(error, "read");
  }
}

export async function PUT(request: NextRequest, context: Context) {
  if (isCrossOriginCookieRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const parsed = latexFileWriteSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid file write", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    const { projectId } = await context.params;
    return NextResponse.json(
      await writeLatexFile(projectId, parsed.data.path, parsed.data.content),
    );
  } catch (error) {
    return failure(error, "write");
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  if (isCrossOriginCookieRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const path = pathFrom(request);
  if (!path.success) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }
  try {
    const { projectId } = await context.params;
    return NextResponse.json(await deleteLatexFile(projectId, path.data));
  } catch (error) {
    return failure(error, "delete");
  }
}
