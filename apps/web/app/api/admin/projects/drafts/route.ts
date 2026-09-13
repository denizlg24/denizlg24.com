import { projectDraftInputSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { saveGitHubProjectDraft } from "@/lib/projects";
import { requireAdmin } from "@/lib/require-admin";

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const parsed = projectDraftInputSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid project draft", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const result = await saveGitHubProjectDraft(parsed.data);
    return NextResponse.json(result, {
      status: result.action === "created" ? 201 : 200,
    });
  } catch (error) {
    console.error("Failed to save project draft:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to save project draft",
      },
      { status: 500 },
    );
  }
}
