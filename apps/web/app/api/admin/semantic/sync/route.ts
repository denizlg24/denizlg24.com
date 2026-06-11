import { type NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { runSemanticKeywordSync } from "@/lib/semantic-llm";
import { serializeSemanticRun } from "@/lib/semantic-route-utils";

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const body = await request.json().catch(() => ({}));
    const result = await runSemanticKeywordSync({
      force: body.force === true,
      missingOnly: body.missingOnly === true,
      limit:
        typeof body.limit === "number" && Number.isFinite(body.limit)
          ? body.limit
          : undefined,
    });
    return NextResponse.json(
      {
        run: result.run
          ? serializeSemanticRun({
              ...result.run.toObject(),
              _id: String(result.run._id),
            })
          : null,
        processed: result.processed,
        failed: result.failed,
        remaining: result.remaining,
        suggestionCount: result.suggestionCount,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error running semantic keyword sync:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed" },
      { status: 500 },
    );
  }
}
