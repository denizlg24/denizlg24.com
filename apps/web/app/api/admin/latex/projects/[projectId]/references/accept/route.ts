import { acceptLatexReferenceSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { latexProjectErrorResponse } from "@/lib/latex-project-route";
import { acceptLatexReference } from "@/lib/latex-references";
import { isCrossOriginCookieRequest } from "@/lib/request-security";
import { requireAdmin } from "@/lib/require-admin";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  if (isCrossOriginCookieRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const parsed = acceptLatexReferenceSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid reference selection", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const { projectId } = await context.params;
    return NextResponse.json(
      await acceptLatexReference(projectId, parsed.data),
    );
  } catch (error) {
    const handled = latexProjectErrorResponse(error);
    if (handled) return handled;
    if (error instanceof Error && /bibliography/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Failed to accept LaTeX reference", error);
    return NextResponse.json(
      { error: "Failed to add reference" },
      { status: 500 },
    );
  }
}
