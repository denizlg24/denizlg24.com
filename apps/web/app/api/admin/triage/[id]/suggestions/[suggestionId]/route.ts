import { type NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { acceptSuggestion, dismissSuggestion } from "@/lib/triage";

const SUGGESTION_TYPES = ["task", "event"] as const;
const SUGGESTION_ACTIONS = ["accept", "dismiss"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSuggestionType(
  value: unknown,
): value is (typeof SUGGESTION_TYPES)[number] {
  return (
    typeof value === "string" && SUGGESTION_TYPES.some((type) => type === value)
  );
}

function isSuggestionAction(
  value: unknown,
): value is (typeof SUGGESTION_ACTIONS)[number] {
  return (
    typeof value === "string" &&
    SUGGESTION_ACTIONS.some((action) => action === value)
  );
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; suggestionId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { id, suggestionId } = await params;
  const body = await request.json().catch(() => null);
  const payload = isRecord(body) ? body : {};
  const { type, action } = payload;

  if (!isSuggestionType(type)) {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }
  if (!isSuggestionAction(action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  if (action === "dismiss") {
    const result = await dismissSuggestion(id, suggestionId, type);
    return NextResponse.json(result);
  }

  const result = await acceptSuggestion(
    id,
    suggestionId,
    type,
    isRecord(payload.overrides) ? payload.overrides : undefined,
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(result);
}
